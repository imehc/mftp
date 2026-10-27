import type { AppError } from "~/bindings";
import { toIpcError } from "~/lib/errors";

import type { JunqiFrame, JunqiIntent } from "./online-protocol";
import {
  JunqiUndoHistory,
  JunqiUndoNegotiation,
  type UndoPending,
} from "./online-undo";
import { applyAction, createInitialState } from "./rules";
import type { JunqiState, JunqiVariant, Side } from "./types";
import type { JunqiView } from "./view-types";
import { projectView } from "./visibility";

export interface JunqiTransport {
  localSeat: Side;
  matchId: string;
  sendMessage(frame: JunqiFrame): Promise<void>;
  onMessage(handler: (frame: JunqiFrame) => void): () => void;
  onPeerPresence(handler: (connected: boolean) => void): () => void;
  onClosed(handler: () => void): () => void;
}

type Request = Extract<JunqiFrame, { t: "rematch-request" }>;

type End = "peer-left" | "send-failed" | "protocol" | "timeout";

export interface JunqiOnlineSnapshot {
  matchId: string;
  round: number;
  localSeat: Side;
  view: JunqiView | null;
  pending: boolean;
  end: End | null;
  error: AppError | null;
  rejected: "stale" | "illegal" | null;
  rematch: { direction: "incoming" | "outgoing"; request: Request } | null;
  undo: UndoPending | null;
  undoDepth: number;
  undoNotice: { requestId: number; kind: "declined" | "stale" } | null;
}

const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

/** 房主裁判持有真值；外部只能订阅当前设备的投影。 */
export class JunqiOnlineController {
  private state: JunqiState | null = null;
  private snapshot: JunqiOnlineSnapshot;
  private listeners = new Set<() => void>();
  private off: (() => void)[] = [];
  private active = false;
  private tail = Promise.resolve();
  private queued = 0;
  private sequence = 0;
  private guestSequence = 0;
  private rematchSequence = 0;
  private awaitingRequest: number | null = null;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private syncing = false;
  private history = new JunqiUndoHistory();
  private undo: JunqiUndoNegotiation;

  constructor(
    private readonly transport: JunqiTransport,
    private readonly variant: JunqiVariant,
    private readonly seed = randomSeed,
  ) {
    if (transport.localSeat === 0)
      this.state = createInitialState(variant, seed());
    this.snapshot = {
      matchId: transport.matchId,
      round: 0,
      localSeat: transport.localSeat,
      view: this.state ? projectView(this.state, 0) : null,
      pending: false,
      end: null,
      error: null,
      rejected: null,
      rematch: null,
      undo: null,
      undoDepth: 0,
      undoNotice: null,
    };
    this.undo = new JunqiUndoNegotiation({
      host: transport.localSeat === 0,
      live: () => this.active,
      snapshot: this.getSnapshot,
      envelope: () => this.envelope(),
      nextId: () => ++this.sequence,
      publish: (patch) => this.publish(patch),
      send: (frame) => this.send(frame),
      enqueue: (work) => this.enqueue(work),
      commit: (plies) => this.restore(plies),
      timeout: () => this.end("timeout"),
    });
  }

  getSnapshot = () => this.snapshot;
  subscribe = (handler: () => void) => {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  };

  private publish(patch: Partial<JunqiOnlineSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const handler of this.listeners) handler();
  }

  start() {
    if (this.active) return;
    this.active = true;
    // 顺序接入会同步排空首帧，回调不得依赖后续监听已经安装。
    this.off.push(this.transport.onClosed(() => this.end("peer-left")));
    this.off.push(
      this.transport.onPeerPresence((connected) => {
        if (!connected) this.end("peer-left");
      }),
    );
    this.off.push(
      this.transport.onMessage((frame) =>
        this.enqueue(() => this.receive(frame)),
      ),
    );
    if (this.transport.localSeat === 1) {
      this.waitForReply();
      void this.send({ v: 1, t: "hello", variant: this.variant });
    }
  }

  private enqueue(work: () => Promise<void>) {
    if (!this.active || this.snapshot.end) return;
    if (++this.queued > 32) {
      this.end("protocol");
      return;
    }
    this.tail = this.tail.then(async () => {
      try {
        if (this.active && !this.snapshot.end) await work();
      } catch (error) {
        this.end("protocol", error);
      } finally {
        this.queued--;
      }
    });
  }

  private waitForReply() {
    clearTimeout(this.deadline);
    this.deadline = setTimeout(() => this.end("timeout"), 15000);
  }

  private clearReply() {
    clearTimeout(this.deadline);
    this.deadline = undefined;
  }

  private end(end: End, error?: unknown) {
    if (!this.active || this.snapshot.end) return;
    this.clearReply();
    this.undo.clear();
    this.publish({
      end,
      pending: false,
      rematch: null,
      undo: null,
      error: error ? toIpcError(error).payload : null,
    });
  }

  private async send(frame: JunqiFrame): Promise<boolean> {
    if (!this.active || this.snapshot.end) return false;
    try {
      await this.transport.sendMessage(frame);
      return this.active && !this.snapshot.end;
    } catch (error) {
      this.end("send-failed", error);
      return false;
    }
  }

  private envelope() {
    return {
      v: 1 as const,
      matchId: this.snapshot.matchId,
      round: this.snapshot.round,
    };
  }

  private async sendState(acceptedRequest: number | null = null) {
    if (!this.state) return;
    const guestSeat = (1 - this.snapshot.localSeat) as Side;
    await this.send({
      ...this.envelope(),
      t: "state",
      acceptedRequest,
      undoDepth: this.history.depth,
      view: projectView(this.state, guestSeat),
    });
  }

  submit = (action: JunqiIntent) => {
    const s = this.snapshot;
    if (
      !this.active ||
      s.end ||
      s.pending ||
      s.rematch ||
      s.undo ||
      !s.view ||
      s.view.phase === "finished" ||
      s.view.turnSeat !== s.localSeat
    )
      return;
    this.publish({ pending: true, rejected: null });
    if (this.transport.localSeat === 0)
      this.enqueue(() => this.apply(action, s.localSeat, null));
    else {
      const requestId = ++this.sequence;
      this.awaitingRequest = requestId;
      this.waitForReply();
      void this.send({
        ...this.envelope(),
        t: "action",
        revision: s.view.revision,
        requestId,
        action,
      });
    }
  };

  private async apply(
    action: JunqiIntent,
    seat: Side,
    requestId: number | null,
  ) {
    if (!this.state) return;
    try {
      const before = this.state;
      this.state = applyAction(
        this.state,
        action.type === "arrange"
          ? { type: "arrange", seed: this.seed() }
          : action,
        seat,
      );
      this.history.record(before, this.state);
    } catch {
      if (requestId !== null)
        await this.send({
          ...this.envelope(),
          t: "reject",
          requestId,
          revision: this.state.revision,
          reason: "illegal",
        });
      this.publish({
        pending: false,
        rejected: requestId === null ? "illegal" : null,
      });
      return;
    }
    this.publish({
      pending: true,
      view: projectView(this.state, this.snapshot.localSeat),
      undoDepth: this.history.depth,
      rejected: null,
    });
    await this.sendState(requestId);
    if (!this.snapshot.end) this.publish({ pending: false });
  }

  private async receive(frame: JunqiFrame) {
    const host = this.transport.localSeat === 0;
    if (frame.t === "hello") {
      if (!host || frame.variant !== this.variant) {
        this.end("protocol");
        return;
      }
      await this.sendState();
      return;
    }
    if (frame.matchId !== this.snapshot.matchId) return;
    if (frame.t === "state") {
      if (host || frame.view.variant !== this.variant) {
        this.end("protocol");
        return;
      }
      if (frame.round < this.snapshot.round) return;
      const nextRound = frame.round === this.snapshot.round + 1;
      if (
        frame.round > this.snapshot.round &&
        (!nextRound || !this.snapshot.rematch)
      ) {
        this.end("protocol");
        return;
      }
      if (
        !nextRound &&
        this.snapshot.view &&
        frame.view.revision < this.snapshot.view.revision
      )
        return;
      if (nextRound) {
        this.sequence = 0;
        this.rematchSequence = 0;
        this.awaitingRequest = null;
        this.undo.reset();
      }
      if (frame.acceptedRequest === this.awaitingRequest)
        this.awaitingRequest = null;
      this.syncing = false;
      if (this.awaitingRequest === null) this.clearReply();
      this.undo.stateChanged(frame.view.revision);
      this.publish({
        round: frame.round,
        localSeat: ((1 + frame.round) % 2) as Side,
        view: frame.view,
        undoDepth: frame.undoDepth,
        pending:
          this.awaitingRequest !== null ||
          Boolean(this.snapshot.undo && this.snapshot.pending),
        ...(nextRound
          ? { rematch: null, rejected: null, undo: null, undoNotice: null }
          : {}),
      });
      return;
    }
    if (frame.round !== this.snapshot.round) return;
    if (frame.t === "sync") {
      if (host) await this.sendState();
      return;
    }
    if (frame.t === "action") {
      if (!host || !this.state) {
        this.end("protocol");
        return;
      }
      // 请求号单调递增；重复帧只确认当前状态，不能再次执行写操作。
      if (frame.requestId <= this.guestSequence) {
        await this.sendState(frame.requestId);
        return;
      }
      this.guestSequence = frame.requestId;
      if (
        frame.revision !== this.state.revision ||
        this.snapshot.rematch ||
        this.snapshot.undo
      ) {
        await this.send({
          ...this.envelope(),
          t: "reject",
          requestId: frame.requestId,
          revision: this.state.revision,
          reason: "stale",
        });
        return;
      }
      await this.apply(
        frame.action,
        (1 - this.snapshot.localSeat) as Side,
        frame.requestId,
      );
      return;
    }
    if (frame.t === "reject") {
      if (host || frame.requestId !== this.awaitingRequest) return;
      this.awaitingRequest = null;
      this.clearReply();
      this.publish({ pending: true, rejected: frame.reason });
      if (!this.syncing) {
        this.syncing = true;
        this.waitForReply();
        await this.send({ ...this.envelope(), t: "sync" });
      }
      return;
    }
    if (frame.t === "undo-request" || frame.t === "undo-response") {
      await this.undo.receive(frame);
      return;
    }
    if (frame.t === "rematch-request") {
      if (
        this.snapshot.view?.phase !== "finished" ||
        frame.revision !== this.snapshot.view.revision ||
        frame.requestId <= this.rematchSequence
      )
        return;
      this.rematchSequence = frame.requestId;
      if (this.snapshot.rematch?.direction === "outgoing") {
        // 双方同时请求时以房主请求为准，避免生成两次新局。
        if (host) return;
      } else if (this.snapshot.rematch) return;
      this.clearReply();
      this.publish({ rematch: { direction: "incoming", request: frame } });
      return;
    }
    const pending = this.snapshot.rematch;
    if (
      !pending ||
      pending.direction !== "outgoing" ||
      pending.request.requestId !== frame.requestId ||
      pending.request.revision !== frame.revision
    )
      return;
    this.clearReply();
    if (!frame.accept) this.publish({ rematch: null });
    else if (host) await this.newRound();
    else this.waitForReply();
  }

  requestRematch = () => {
    const s = this.snapshot;
    if (
      !this.active ||
      s.end ||
      s.pending ||
      s.rematch ||
      s.undo ||
      s.view?.phase !== "finished"
    )
      return;
    const request: Request = {
      ...this.envelope(),
      t: "rematch-request",
      requestId: ++this.sequence,
      revision: s.view.revision,
    };
    this.publish({ rematch: { direction: "outgoing", request } });
    void this.send(request);
  };

  respondRematch = (accept: boolean) => {
    const pending = this.snapshot.rematch;
    if (
      pending?.direction !== "incoming" ||
      this.snapshot.end ||
      this.snapshot.pending
    )
      return;
    this.publish({ pending: true });
    this.enqueue(async () => {
      const sent = await this.send({
        ...pending.request,
        t: "rematch-response",
        accept,
      });
      if (!sent) return;
      if (!accept) this.publish({ pending: false, rematch: null });
      else if (this.transport.localSeat === 0) await this.newRound();
      else {
        // 同意后等待新局，不能重新弹出同一请求或重复发送同意。
        this.waitForReply();
      }
    });
  };

  private async newRound() {
    const round = this.snapshot.round + 1;
    this.state = createInitialState(this.variant, this.seed());
    this.guestSequence = 0;
    this.rematchSequence = 0;
    this.sequence = 0;
    this.history.clear();
    this.undo.reset();
    const localSeat = (round % 2) as Side;
    this.publish({
      round,
      localSeat,
      view: projectView(this.state, localSeat),
      rematch: null,
      pending: true,
      rejected: null,
      undo: null,
      undoDepth: 0,
      undoNotice: null,
    });
    await this.sendState();
    if (!this.snapshot.end) this.publish({ pending: false });
  }

  requestUndo = () => this.undo.request();
  respondUndo = (accept: boolean) => this.undo.respond(accept);

  private async restore(plies: number) {
    if (!this.state) return;
    const restored = this.history.restore(plies, this.state.revision);
    if (!restored) {
      this.end("protocol");
      return;
    }
    this.state = restored;
    this.undo.clear();
    this.publish({
      view: projectView(restored, this.snapshot.localSeat),
      undoDepth: this.history.depth,
      undo: null,
      pending: true,
      rejected: null,
    });
    await this.sendState();
    if (!this.snapshot.end) this.publish({ pending: false });
  }

  dispose() {
    this.active = false;
    this.clearReply();
    this.undo.reset();
    this.history.clear();
    for (const off of this.off.splice(0)) off();
    this.listeners.clear();
    this.state = null;
  }
}
