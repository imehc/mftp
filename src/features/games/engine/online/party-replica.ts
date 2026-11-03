import { z } from "zod";

import type {
  AppError,
  GamePartyEnvelope,
  GamePartyEvent,
  GamePartyStatus,
} from "~/bindings";
import { toIpcError } from "~/lib/errors";
import { gamePartySend, nextPartySequence } from "~/lib/ipc";

import type { GameOutcome } from "../outcome";
import { gameOutcomeSchema } from "../outcome-schema";
import type { ParticipantSummary } from "../participants";
import type { PartyGameAdapter, PartySend } from "./party-authority";

export interface PartyReplicaSnapshot<O> {
  readonly observation: O | null;
  readonly activeSeat: number | null;
  readonly finished: boolean;
  readonly outcome: GameOutcome | null;
  readonly participants: readonly ParticipantSummary[];
  readonly generation: number;
  readonly revision: number;
  readonly connected: boolean;
  readonly pending: boolean;
  readonly error: AppError | null;
}

const projection = z.strictObject({
  observation: z.unknown(),
  activeSeat: z.number().int().min(0).max(63).nullable(),
  outcome: gameOutcomeSchema.nullable(),
  participants: z
    .array(
      z.strictObject({
        seat: z.number().int().min(0).max(63),
        kind: z.enum(["local", "computer", "remote"]),
        teamId: z.string().min(1).max(128).optional(),
      }),
    )
    .min(1)
    .max(64),
  finished: z.boolean(),
});

/** 远端只持有本座位观察，不创建包含完整状态的规则引擎。 */
export class PartyReplica<S, M, O, E> {
  private snapshot: PartyReplicaSnapshot<O>;
  private readonly listeners = new Set<() => void>();
  private matchId: string | null = null;
  private receivedSequence = 0;
  private disposed = false;
  private suspended = false;
  private actionId: string | null = null;
  private readonly room: GamePartyStatus;

  constructor(
    room: GamePartyStatus,
    private readonly adapter: PartyGameAdapter<S, M, O, E>,
    private readonly send: PartySend = gamePartySend,
  ) {
    if (room.hosting || room.seat === 0)
      throw new Error("Replica requires a remote seat");
    this.room = structuredClone(room);
    this.snapshot = {
      observation: null,
      activeSeat: null,
      finished: false,
      outcome: null,
      participants: [],
      generation: 0,
      revision: 0,
      connected: room.connected,
      pending: false,
      error: null,
    };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  receive(event: GamePartyEvent): void {
    if (this.disposed || event.instanceId !== this.room.instanceId) return;
    if (event.type === "disconnected") {
      if (event.connectionGeneration !== this.room.connectionGeneration) return;
      this.disconnect();
      return;
    }
    if (event.type === "members") {
      this.room.members = structuredClone(event.members);
      const connected = event.members.some(
        (member) => member.memberId === this.room.memberId && member.connected,
      );
      this.publish({ connected });
      return;
    }
    const envelope = event.envelope;
    const host = this.room.members.find(
      (member) => member.seat === 0 && member.connected,
    );
    if (
      !host ||
      event.memberId !== host.memberId ||
      event.seat !== 0 ||
      event.connectionGeneration !== host.connectionGeneration ||
      envelope.protocolVersion !== 3 ||
      envelope.roomId !== this.room.roomId ||
      envelope.rulesVersion !== this.room.rulesVersion ||
      envelope.sequence <= this.receivedSequence ||
      envelope.generation < this.snapshot.generation
    )
      return;
    try {
      const payload: unknown = JSON.parse(envelope.payload);
      if (envelope.kind === "start") {
        if (
          envelope.revision !== 0 ||
          (this.matchId !== null &&
            envelope.generation <= this.snapshot.generation)
        )
          return;
        this.matchId = envelope.matchId;
        this.actionId = null;
        this.publish({
          observation: null,
          participants: [],
          outcome: null,
          finished: false,
          generation: envelope.generation,
          revision: 0,
          activeSeat: null,
          pending: false,
          error: null,
        });
      } else if (envelope.kind === "snapshot") {
        if (
          this.matchId !== null &&
          envelope.matchId !== this.matchId &&
          envelope.generation <= this.snapshot.generation
        )
          return;
        if (
          envelope.generation === this.snapshot.generation &&
          envelope.revision < this.snapshot.revision
        )
          return;
        const parsed = projection.parse(payload);
        if (
          parsed.participants.length !== this.room.seatCount ||
          new Set(parsed.participants.map((participant) => participant.seat))
            .size !== this.room.seatCount ||
          parsed.participants.some(
            (participant) => participant.seat >= this.room.seatCount,
          )
        )
          throw new Error("Invalid participant projection");
        if (
          parsed.activeSeat !== null &&
          parsed.activeSeat >= this.room.seatCount
        )
          throw new Error("Invalid active seat");
        const observation = this.adapter.parseObservation(parsed.observation);
        this.matchId = envelope.matchId;
        this.actionId = null;
        this.publish({
          observation: structuredClone(observation),
          activeSeat: this.suspended ? null : parsed.activeSeat,
          finished: parsed.finished,
          outcome: parsed.outcome,
          participants: parsed.participants,
          generation: envelope.generation,
          revision: envelope.revision,
          pending: false,
          error: null,
        });
      } else if (envelope.kind === "commit") {
        if (
          envelope.matchId !== this.matchId ||
          envelope.generation !== this.snapshot.generation ||
          envelope.revision !== this.snapshot.revision + 1
        )
          return;
        if (!payload || typeof payload !== "object" || !("event" in payload))
          throw new Error("Invalid public commit");
        this.adapter.parseEvent(payload.event);
        // 等本座位快照到达后才开放输入，不从公开事件猜测私有状态。
        this.publish({ revision: envelope.revision, activeSeat: null });
      } else return;
      this.receivedSequence = envelope.sequence;
    } catch (cause) {
      this.publish({ error: toIpcError(cause).payload, activeSeat: null });
    }
  }

  async submit(action: M): Promise<boolean> {
    const snapshot = this.snapshot;
    if (
      this.disposed ||
      this.suspended ||
      !snapshot.connected ||
      !this.matchId ||
      snapshot.observation === null ||
      snapshot.finished ||
      snapshot.pending ||
      snapshot.activeSeat !== this.room.seat
    )
      return false;
    let valid: M;
    try {
      valid = this.adapter.parseAction(
        action,
        structuredClone(snapshot.observation),
        this.room.seat,
      );
    } catch (cause) {
      this.publish({ error: toIpcError(cause).payload });
      return false;
    }
    const actionId = crypto.randomUUID();
    this.actionId = actionId;
    this.publish({ pending: true, error: null });
    const envelope: GamePartyEnvelope = {
      protocolVersion: 3,
      roomId: this.room.roomId,
      matchId: this.matchId,
      rulesVersion: this.room.rulesVersion,
      generation: snapshot.generation,
      revision: snapshot.revision,
      sequence: nextPartySequence(this.room.instanceId),
      actionId,
      kind: "action",
      payload: JSON.stringify({ action: valid }),
    };
    try {
      await this.send(this.room.instanceId, null, envelope);
      return true;
    } catch (cause) {
      if (!this.disposed && this.actionId === actionId)
        this.publish({ pending: false, error: toIpcError(cause).payload });
      return false;
    }
  }

  /** 新连接等待新的本座位恢复快照，先前未确认动作不重放。 */
  disconnect(): void {
    this.suspended = true;
    this.actionId = null;
    this.publish({ connected: false, pending: false, activeSeat: null });
  }

  pause(): void {
    this.suspended = true;
    this.publish({ activeSeat: null });
  }

  /** 前台恢复只请求观察，不自动提交先前动作；失效连接由连接资源显式认证恢复。 */
  async resume(): Promise<void> {
    if (this.disposed || !this.snapshot.connected || !this.matchId) return;
    this.suspended = false;
    this.actionId = null;
    this.publish({ pending: false, activeSeat: null });
    try {
      await this.send(this.room.instanceId, null, {
        protocolVersion: 3,
        roomId: this.room.roomId,
        matchId: this.matchId,
        rulesVersion: this.room.rulesVersion,
        generation: this.snapshot.generation,
        revision: this.snapshot.revision,
        sequence: nextPartySequence(this.room.instanceId),
        actionId: crypto.randomUUID(),
        kind: "request",
        payload: JSON.stringify({ type: "snapshot" }),
      });
    } catch (cause) {
      this.suspended = true;
      this.publish({ error: toIpcError(cause).payload });
    }
  }

  reconnected(status?: GamePartyStatus): void {
    if (
      status &&
      (status.instanceId !== this.room.instanceId ||
        status.memberId !== this.room.memberId ||
        status.seat !== this.room.seat)
    )
      throw new Error("Reconnected room identity changed");
    if (status) this.room.members = structuredClone(status.members);
    if (status) this.room.connectionGeneration = status.connectionGeneration;
    this.suspended = false;
    this.receivedSequence = 0;
    this.actionId = null;
    this.publish({ connected: true, pending: false, activeSeat: null });
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private publish(patch: Partial<PartyReplicaSnapshot<O>>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    for (const listener of this.listeners) listener();
  }
}
