import type {
  AppError,
  GamePartyEnvelope,
  GamePartyEvent,
  GamePartyMember,
  GamePartyStatus,
} from "~/bindings";
import { toIpcError } from "~/lib/errors";
import {
  gamePartySend,
  nextPartyGeneration,
  nextPartySequence,
  queuePartyOperation,
} from "~/lib/ipc";

import { RemoteController } from "../controllers";
import type { MatchRunner } from "../match";
import { createMatchHandle, type MatchHandle } from "../match-handle";
import {
  createParticipantSession,
  type GameParticipantAdapters,
} from "../participant-session";
import type { ParticipantConfiguration } from "../participants";
import type { GameDefinition } from "../types";

/** 此适配在权威边界运行；公开事件须由游戏显式剔除隐藏信息。 */
export interface PartyGameAdapter<S, M, O, E> {
  parseAction(value: unknown, observation: O, seat: number): M;
  publicEvent(state: S, move: M, seat: number): E;
  parseObservation(value: unknown): O;
  parseEvent(value: unknown): E;
  allowUndo?(state: S, plies: number): boolean;
}

export type PartySend = (
  instanceId: string,
  targetMemberId: string | null,
  envelope: GamePartyEnvelope,
) => Promise<void>;

export class PartyAuthority<S, M, P, O, E> {
  readonly handle: MatchHandle<O, M>;
  private readonly runner: MatchRunner<S, M, P, O>;
  private readonly remotes = new Map<number, RemoteController<O, M>>();
  private members: GamePartyMember[];
  private readonly matchId = crypto.randomUUID();
  private generation: number;
  private revision = 0;
  private disposed = false;
  private started = false;
  private accepted: string | null = null;
  private readonly recent = new Set<string>();
  private failure: AppError | null = null;
  private suspended = true;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly room: GamePartyStatus,
    private readonly game: GameDefinition<S, M, P, O>,
    initial: S,
    private readonly configuration: ParticipantConfiguration,
    private readonly adapters: Omit<GameParticipantAdapters<O, M>, "remote">,
    private readonly adapter: PartyGameAdapter<S, M, O, E>,
    private readonly send: PartySend = gamePartySend,
  ) {
    if (
      !room.hosting ||
      room.protocolVersion !== 3 ||
      room.gameId !== game.id ||
      room.seat !== 0 ||
      room.seatCount !== game.seatCount ||
      room.rulesVersion !== game.version ||
      configuration.viewerSeat !== 0
    )
      throw new Error("Invalid authority room configuration");
    this.members = [...room.members];
    this.generation = nextPartyGeneration(room.instanceId);
    const session = createParticipantSession(
      game,
      initial,
      configuration,
      {
        ...adapters,
        remote: (seat) => {
          if (
            !room.members.some(
              (member) =>
                member.memberId === seat.memberId && member.seat === seat.seat,
            )
          )
            throw new Error("Remote seat has no verified member");
          const controller = new RemoteController<O, M>();
          this.remotes.set(seat.seat, controller);
          return controller;
        },
      },
      {
        onMoveResolved: async ({ move, seat }) => {
          if (this.disposed) return;
          this.revision++;
          const originActionId = this.accepted;
          this.accepted = null;
          const state = this.authorityState();
          try {
            await this.queue(async () => {
              await this.emit("commit", {
                event: this.adapter.publicEvent(state, move, seat),
                originActionId,
              });
              await this.snapshots(state);
            });
          } catch (cause) {
            this.fail(cause);
          }
        },
        onError: (cause) => {
          this.fail(cause);
        },
      },
    );
    this.runner = session.runner;
    const base = createMatchHandle(this.runner);
    this.handle = {
      ...base,
      start: () => {
        void this.start();
      },
      resume: () => {
        void this.resume();
      },
      pause: () => this.pause(),
      undo: (plies) => this.undo(plies),
      dispose: () => this.dispose(),
      get hasStarted() {
        return base.hasStarted;
      },
      get controllers() {
        return base.controllers;
      },
      get awaitingLocalInput() {
        return base.awaitingLocalInput;
      },
    };
  }

  get error(): AppError | null {
    return this.failure;
  }
  get paused(): boolean {
    return this.suspended;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    try {
      await this.queue(async () => {
        await this.emit("start", { seatCount: this.game.seatCount });
        await this.snapshots(this.authorityState());
      });
      if (!this.disposed && this.connected()) {
        this.suspended = false;
        this.runner.start();
        this.notify();
      }
    } catch (cause) {
      this.fail(cause);
    }
  }

  receive(event: GamePartyEvent): void {
    if (this.disposed || event.instanceId !== this.room.instanceId) return;
    if (event.type === "members") {
      const old = this.members;
      this.members = structuredClone(event.members);
      if (!this.connected()) this.pause();
      if (this.started)
        for (const member of this.members) {
          const previous = old.find(
            (value) => value.memberId === member.memberId,
          );
          if (
            member.connected &&
            (!previous?.connected ||
              member.connectionGeneration !== previous.connectionGeneration)
          )
            void this.synchronizeMember(member.memberId).catch((cause) =>
              this.fail(cause),
            );
        }
      return;
    }
    if (event.type !== "message") return;
    const envelope = event.envelope;
    const member = this.members.find(
      (member) =>
        member.memberId === event.memberId &&
        member.seat === event.seat &&
        member.connected &&
        member.connectionGeneration === event.connectionGeneration,
    );
    const snapshot = this.runner.getSnapshot();
    if (
      member &&
      this.remotes.has(event.seat) &&
      envelope.kind === "request" &&
      envelope.protocolVersion === 3 &&
      envelope.roomId === this.room.roomId &&
      envelope.rulesVersion === this.game.version &&
      envelope.matchId === this.matchId &&
      envelope.generation === this.generation &&
      envelope.revision <= this.revision
    ) {
      try {
        const value: unknown = JSON.parse(envelope.payload);
        if (
          value &&
          typeof value === "object" &&
          "type" in value &&
          value.type === "snapshot"
        )
          void this.synchronizeMember(member.memberId).catch((cause) =>
            this.fail(cause),
          );
      } catch (cause) {
        this.fail(cause);
      }
      return;
    }
    if (
      this.suspended ||
      !member ||
      !this.remotes.has(event.seat) ||
      this.accepted ||
      this.recent.has(envelope.actionId) ||
      envelope.kind !== "action" ||
      envelope.protocolVersion !== 3 ||
      envelope.roomId !== this.room.roomId ||
      envelope.matchId !== this.matchId ||
      envelope.rulesVersion !== this.game.version ||
      envelope.generation !== this.generation ||
      envelope.revision !== this.revision ||
      snapshot.activeSeat !== event.seat ||
      snapshot.phase !== "awaiting-move"
    )
      return;
    try {
      const payload: unknown = JSON.parse(envelope.payload);
      if (!payload || typeof payload !== "object" || !("action" in payload))
        throw new Error("Invalid game action payload");
      const observation = this.game.observe(this.authorityState(), event.seat);
      const move = this.adapter.parseAction(
        payload.action,
        structuredClone(observation),
        event.seat,
      );
      this.accepted = envelope.actionId;
      this.recent.add(envelope.actionId);
      if (this.recent.size > 128)
        this.recent.delete(this.recent.values().next().value!);
      this.remotes.get(event.seat)?.push(move);
    } catch (cause) {
      this.fail(cause);
    }
  }

  /** 重连只补该成员当前可见快照，未确认的动作不会自动重放。 */
  async synchronizeMember(memberId: string): Promise<void> {
    const member = this.members.find(
      (member) => member.memberId === memberId && member.connected,
    );
    if (!member || !this.remotes.has(member.seat)) return;
    await this.queue(() => this.snapshotFor(this.authorityState(), member));
  }

  async resume(): Promise<void> {
    if (this.disposed || !this.started || !this.connected()) return;
    try {
      await this.queue(async () => {
        if (!this.runner.hasStarted) {
          this.generation = nextPartyGeneration(this.room.instanceId);
          await this.emit("start", { seatCount: this.game.seatCount });
        }
        await this.snapshots(this.authorityState());
      });
      if (this.disposed || !this.connected()) return;
      this.failure = null;
      this.suspended = false;
      this.runner.resume();
      this.runner.start();
      this.notify();
    } catch (cause) {
      this.fail(cause);
    }
  }

  pause(): void {
    this.suspended = true;
    this.accepted = null;
    this.runner.pause(true);
    this.notify();
  }

  restart(initial: S): PartyAuthority<S, M, P, O, E> {
    this.dispose();
    return new PartyAuthority(
      { ...this.room, members: this.members },
      this.game,
      initial,
      this.configuration,
      this.adapters,
      this.adapter,
      this.send,
    );
  }

  undo(plies: number): boolean {
    const state = this.authorityState();
    if (!this.adapter.allowUndo?.(state, plies) || !this.runner.undo(plies))
      return false;
    // 回退属于新代次，不能让旧动作在复用的修订号上生效。
    this.pause();
    this.generation = nextPartyGeneration(this.room.instanceId);
    this.revision = 0;
    this.recent.clear();
    void this.queue(async () => {
      await this.emit("start", { seatCount: this.game.seatCount });
      await this.snapshots(this.authorityState());
    }).catch((cause) => this.fail(cause));
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.runner.dispose();
    this.listeners.clear();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private fail(cause: unknown): void {
    if (this.disposed) return;
    this.failure = toIpcError(cause).payload;
    this.pause();
  }

  private authorityState(): S {
    return this.runner.getAuthorityState();
  }

  private connected(): boolean {
    return [...this.remotes.keys()].every((seat) =>
      this.members.some((member) => member.seat === seat && member.connected),
    );
  }

  private queue(work: () => Promise<void>): Promise<void> {
    return queuePartyOperation(this.room.instanceId, async () => {
      if (!this.disposed) await work();
    });
  }

  private emit(
    kind: GamePartyEnvelope["kind"],
    payload: object,
    memberId: string | null = null,
  ): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.send(this.room.instanceId, memberId, {
      protocolVersion: 3,
      roomId: this.room.roomId,
      matchId: this.matchId,
      rulesVersion: this.game.version,
      generation: this.generation,
      revision: this.revision,
      actionId: crypto.randomUUID(),
      sequence: nextPartySequence(this.room.instanceId),
      kind,
      payload: JSON.stringify(payload),
    });
  }

  private snapshots(state: S): Promise<void> {
    return this.members
      .filter((member) => member.connected && this.remotes.has(member.seat))
      .reduce(
        (tail, member) => tail.then(() => this.snapshotFor(state, member)),
        Promise.resolve(),
      );
  }

  private snapshotFor(state: S, member: GamePartyMember): Promise<void> {
    return this.emit(
      "snapshot",
      {
        observation: this.game.observe(state, member.seat),
        activeSeat: this.game.currentSeat(state),
        outcome: this.game.outcome(state),
        finished: this.game.isFinished(state),
        participants: this.runner.getSnapshot().participants,
      },
      member.memberId,
    );
  }
}
