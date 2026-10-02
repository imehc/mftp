import { toIpcError } from "~/lib/errors";
import { LocalController, RemoteController } from "../controllers";
import { MatchRunner } from "../match";
import type { RemoteMove } from "../transport";
import { ONLINE_PROTOCOL_VERSION, type MatchControlMessage } from "./protocol";
import type {
  MatchEnd,
  NegotiationRequest,
  NegotiationResponse,
  OnlineGame,
  OnlineMatchSnapshot,
  OnlineRound,
  OnlineTransport,
  Presentation,
} from "./matchTypes";

class GuardedLocal<S, M> extends LocalController<S, M> {
  constructor(
    private allowed: () => boolean,
    private submitted: () => void,
  ) {
    super();
  }
  override submit(move: M): boolean {
    if (!this.allowed()) return false;
    const accepted = super.submit(move);
    if (accepted) this.submitted();
    return accepted;
  }
}

type Delivery<M> = { t: "move"; move: RemoteMove<M> } | MatchControlMessage;
const MAX_INBOX = 128;
// 超时后结束会话，不擅自恢复输入；对方可能已同意但响应还在途中。
const NEGOTIATION_TIMEOUT_MS = 30_000;

export class OnlineMatchController<S, M, P> {
  private snapshot: OnlineMatchSnapshot<S, M, P>;
  private listeners = new Set<() => void>();
  private off: (() => void)[] = [];
  private offRunner = () => {};
  private remote!: RemoteController<S, M>;
  private remoteMove: RemoteMove<M> | null = null;
  private localInFlight = false;
  private inbox: Delivery<M>[] = [];
  private drainScheduled = false;
  private outbound = Promise.resolve();
  private requestId = 0;
  private lastPeerRequest = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private references = 0;
  private started = false;
  private disposed = false;
  onPresentation?: Presentation<S, P>;

  constructor(
    private transport: OnlineTransport<M>,
    private definition: OnlineGame<S, M, P>,
  ) {
    this.snapshot = {
      round: 0,
      revision: 0,
      localSeat: transport.localSeat,
      match: this.createRound(transport.localSeat),
      pending: null,
      committing: false,
      end: null,
      error: null,
      notice: null,
    };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<OnlineMatchSnapshot<S, M, P>>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  retain(): () => void {
    if (this.disposed) return () => {};
    this.references++;
    if (!this.started) {
      this.started = true;
      // 消费缓冲时只入队；等所有监听与 runner 就绪后再按共同顺序处理。
      this.off.push(
        this.transport.onRemoteMove((move) =>
          this.enqueue({ t: "move", move }),
        ),
      );
      this.off.push(this.transport.onControl((frame) => this.enqueue(frame)));
      this.off.push(
        this.transport.onPeerPresence((connected) => {
          if (!connected) this.fail("peer-left");
        }),
      );
      this.off.push(
        this.transport.onClosed(() => this.fail("connection-lost")),
      );
      if (!this.snapshot.end) this.snapshot.match.runner.start();
    }
    this.scheduleDrain();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.references--;
      // StrictMode 紧接着重新安装 effect 时保留同一对局；真实卸载
      // 立即禁止输入和交付，在微任务中回收 runner、定时器和监听。
      queueMicrotask(() => {
        if (this.references === 0) this.dispose();
      });
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    for (const off of this.off) off();
    this.off = [];
    this.offRunner();
    this.snapshot.match.runner.dispose();
    this.inbox = [];
  }
  private get live() {
    return !this.disposed && this.references > 0 && !this.snapshot.end;
  }
  private stable(): boolean {
    return (
      !this.localInFlight &&
      !this.remoteMove &&
      this.snapshot.match.runner.getSnapshot().phase !== "resolving"
    );
  }
  private allowInput(): boolean {
    return (
      this.live &&
      this.stable() &&
      !this.snapshot.pending &&
      !this.snapshot.committing
    );
  }
  private fail(end: MatchEnd, error?: unknown): void {
    if (this.disposed || this.snapshot.end) return;
    clearTimeout(this.timer);
    this.snapshot.match.runner.dispose();
    this.inbox = [];
    this.transport.close();
    this.publish({
      end,
      error: error === undefined ? null : toIpcError(error).payload,
      pending: null,
      committing: false,
    });
  }

  private createRound(localSeat: number): OnlineRound<S, M, P> {
    const local = new GuardedLocal<S, M>(
      () => this.allowInput(),
      () => {
        this.localInFlight = true;
      },
    );
    const remote = new RemoteController<S, M>();
    this.remote = remote;
    const runner = new MatchRunner(
      this.definition.game,
      this.definition.initialState(),
      localSeat === 0 ? [local, remote] : [remote, local],
      {
        onMoveResolved: async ({ seat, move, moveIndex, resolution }) => {
          if (!this.live) return;
          const stateHash = this.definition.hash(resolution.state);
          if (seat !== localSeat) {
            // 远端走法先核对 seq/seat/修订与哈希再呈现，非法走法不播放表现。
            const expected = this.remoteMove;
            if (
              !expected ||
              expected.seq !== moveIndex ||
              expected.seat !== seat ||
              expected.stateHash !== stateHash
            ) {
              this.fail("desync");
              return;
            }
            this.remoteMove = null;
          }
          if (this.live) this.onPresentation?.(resolution);
          if (seat === localSeat) {
            const { round, revision } = this.snapshot;
            await this.send(() =>
              this.transport.sendMove({
                round,
                revision,
                seq: moveIndex,
                seat,
                move,
                stateHash,
              }),
            );
          }
        },
        onError: () => this.fail("desync"),
      },
    );
    this.offRunner = runner.subscribe(() => {
      if (this.snapshot.match.runner !== runner) return;
      if (runner.getSnapshot().phase !== "resolving")
        this.localInFlight = false;
      this.scheduleDrain();
    });
    return { local, runner };
  }

  private send(action: () => Promise<void>): Promise<void> {
    // 同一 WebView 的 IPC 可并发进入 Rust，显式排队保留协议写入顺序。
    const result = this.outbound
      .then(async () => {
        if (this.disposed || this.snapshot.end) return;
        await action();
      })
      .catch((error) => {
        this.fail("send-failed", error);
      });
    this.outbound = result;
    return result;
  }
  private enqueue(frame: Delivery<M>): void {
    if (this.disposed || this.snapshot.end) return;
    if (this.inbox.length >= MAX_INBOX) {
      this.fail("desync");
      return;
    }
    this.inbox.push(frame);
    this.scheduleDrain();
  }
  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      try {
        while (
          this.live &&
          this.stable() &&
          !this.snapshot.committing &&
          this.inbox.length
        ) {
          const frame = this.inbox.shift()!;
          if (frame.t === "move") this.receiveMove(frame.move);
          else this.receiveControl(frame);
        }
      } catch {
        this.fail("desync");
      }
    });
  }
  private generation(
    round: number,
    revision: number,
  ): "current" | "old" | "future" {
    const own = this.snapshot;
    if (round < own.round || (round === own.round && revision < own.revision))
      return "old";
    if (round === own.round && revision === own.revision) return "current";
    return "future";
  }
  private receiveMove(move: RemoteMove<M>): void {
    const generation = this.generation(move.round, move.revision);
    if (generation === "old") return;
    if (generation === "future") {
      this.fail("desync");
      return;
    }
    const board = this.snapshot.match.runner.getSnapshot();
    if (move.seq < board.moveCount) return;
    if (
      move.seq !== board.moveCount ||
      move.seat !== 1 - this.snapshot.localSeat ||
      move.seat !== board.activeSeat ||
      board.phase !== "awaiting-move"
    ) {
      this.fail("desync");
      return;
    }
    if (this.snapshot.pending?.direction === "incoming") {
      this.fail("desync");
      return;
    }
    // 请求与对端已发出的走法交叉时，旧请求失效；晚到响应不能回退新状态。
    this.clearPending();
    this.remoteMove = move;
    this.remote.push(move.move);
  }
  private matchesBoard(request: NegotiationRequest): boolean {
    const board = this.snapshot.match.runner.getSnapshot();
    return (
      request.atMove === board.moveCount &&
      request.stateHash === this.definition.hash(board.state) &&
      (request.t === "undo-request"
        ? board.phase === "awaiting-move" && request.plies <= board.moveCount
        : board.phase === "finished")
    );
  }
  private setPending(
    direction: "incoming" | "outgoing",
    request: NegotiationRequest,
  ): void {
    clearTimeout(this.timer);
    this.publish({ pending: { direction, request } });
    this.timer = setTimeout(() => this.fail("timeout"), NEGOTIATION_TIMEOUT_MS);
  }
  private clearPending(): void {
    clearTimeout(this.timer);
    if (this.snapshot.pending) this.publish({ pending: null });
  }
  private response(
    request: NegotiationRequest,
    accept: boolean,
  ): NegotiationResponse {
    return request.t === "undo-request"
      ? { ...request, t: "undo-response", accept }
      : { ...request, t: "rematch-response", accept };
  }
  private receiveControl(frame: MatchControlMessage): void {
    const generation = this.generation(frame.round, frame.revision);
    if (generation === "old") return;
    if (generation === "future") {
      this.fail("desync");
      return;
    }
    if (frame.t === "undo-request" || frame.t === "rematch-request") {
      if (frame.requestId <= this.lastPeerRequest) return;
      this.lastPeerRequest = frame.requestId;
      if (this.snapshot.pending || !this.matchesBoard(frame)) {
        void this.send(() =>
          this.transport.sendControl(this.response(frame, false)),
        );
      } else this.setPending("incoming", frame);
      return;
    }
    const pending = this.snapshot.pending;
    if (!pending || pending.direction !== "outgoing") return;
    const request = pending.request;
    if (
      frame.requestId !== request.requestId ||
      frame.atMove !== request.atMove ||
      frame.stateHash !== request.stateHash ||
      (request.t === "undo-request"
        ? frame.t !== "undo-response" || frame.plies !== request.plies
        : frame.t !== "rematch-response")
    )
      return;
    if (!this.matchesBoard(request)) {
      this.fail("desync");
      return;
    }
    this.clearPending();
    if (frame.accept) this.commit(request);
    else
      this.publish({
        notice: {
          id: (this.snapshot.notice?.id ?? 0) + 1,
          kind: request.t === "undo-request" ? "undo" : "rematch",
        },
      });
  }

  requestUndo = (plies: number): void => {
    this.request("undo-request", plies);
  };
  requestRematch = (): void => {
    this.request("rematch-request");
  };
  private request(type: NegotiationRequest["t"], plies = 0): void {
    if (
      !this.allowInput() ||
      !Number.isSafeInteger(plies) ||
      (type === "undo-request" && plies <= 0)
    )
      return;
    if (this.requestId === Number.MAX_SAFE_INTEGER) {
      this.fail("desync");
      return;
    }
    const board = this.snapshot.match.runner.getSnapshot();
    const base = {
      v: ONLINE_PROTOCOL_VERSION,
      round: this.snapshot.round,
      revision: this.snapshot.revision,
      requestId: ++this.requestId,
      atMove: board.moveCount,
      stateHash: this.definition.hash(board.state),
    } as const;
    const request: NegotiationRequest =
      type === "undo-request"
        ? { ...base, t: type, plies }
        : { ...base, t: type };
    if (!this.matchesBoard(request)) return;
    this.setPending("outgoing", request);
    void this.send(() => this.transport.sendControl(request));
  }
  respondUndo = (accept: boolean): void => {
    void this.respond("undo-request", accept);
  };
  respondRematch = (accept: boolean): void => {
    void this.respond("rematch-request", accept);
  };
  private async respond(
    type: NegotiationRequest["t"],
    accept: boolean,
  ): Promise<void> {
    const pending = this.snapshot.pending;
    if (
      !this.live ||
      this.snapshot.committing ||
      !pending ||
      pending.direction !== "incoming" ||
      pending.request.t !== type
    )
      return;
    const request = pending.request;
    if (!this.matchesBoard(request)) {
      this.fail("desync");
      return;
    }
    this.publish({ committing: true });
    await this.send(() =>
      this.transport.sendControl(this.response(request, accept)),
    );
    if (!this.live) return;
    this.clearPending();
    if (accept) this.commit(request);
    this.publish({ committing: false });
    this.scheduleDrain();
  }
  private commit(request: NegotiationRequest): void {
    if (!this.matchesBoard(request)) {
      this.fail("desync");
      return;
    }
    if (request.t === "undo-request") {
      if (
        this.snapshot.revision === Number.MAX_SAFE_INTEGER ||
        !this.snapshot.match.runner.undo(request.plies)
      ) {
        this.fail("desync");
        return;
      }
      this.publish({ revision: this.snapshot.revision + 1 });
    } else {
      if (this.snapshot.round === Number.MAX_SAFE_INTEGER) {
        this.fail("desync");
        return;
      }
      this.offRunner();
      this.snapshot.match.runner.dispose();
      this.remoteMove = null;
      this.localInFlight = false;
      const round = this.snapshot.round + 1;
      const localSeat = (this.transport.localSeat + round) % 2;
      this.publish({
        round,
        revision: 0,
        localSeat,
        match: this.createRound(localSeat),
      });
      this.snapshot.match.runner.start();
    }
  }
}
