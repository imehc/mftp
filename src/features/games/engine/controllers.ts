/**
 * PlayerController 的实现。对局循环对每个座位一视同仁；这些类把
 * UI 输入和 AI 策略（以及第三阶段的远端对手）适配到该契约上。
 */
import { abortableDelay, type AiStrategy, type Difficulty } from "./ai";
import type { MoveRequestContext, PlayerController, SeatIndex } from "./types";

/**
 * 把 UI 输入桥接进对局循环：`requestMove` 挂起一个 promise，
 * 待玩家提交动作后，游戏界面通过调用 `submit(move)` 来兑现它。
 */
export class LocalController<S, M> implements PlayerController<S, M> {
  readonly kind = "local" as const;

  private pending: {
    resolve: (move: M) => void;
    reject: (reason: unknown) => void;
    cleanup: () => void;
  } | null = null;

  requestMove(ctx: MoveRequestContext<S>): Promise<M> {
    this.cancelPending(new DOMException("Superseded", "AbortError"));
    return new Promise<M>((resolve, reject) => {
      const onAbort = () => {
        this.pending = null;
        reject(ctx.signal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      this.pending = {
        resolve,
        reject,
        cleanup: () => ctx.signal.removeEventListener("abort", onAbort),
      };
    });
  }

  /** 对局循环正在等待此控制器时为 true。 */
  get awaitingInput(): boolean {
    return this.pending !== null;
  }

  /** 提交玩家走法；若没有待提交的走法则返回 false。 */
  submit(move: M): boolean {
    const pending = this.pending;
    if (!pending) return false;
    this.pending = null;
    pending.cleanup();
    pending.resolve(move);
    return true;
  }

  dispose(): void {
    this.cancelPending(new DOMException("Disposed", "AbortError"));
  }

  private cancelPending(reason: unknown): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.cleanup();
    pending.reject(reason);
  }
}

/**
 * 以固定难度运行游戏提供的 AiStrategy。把极快的搜索补足到
 * `minThinkMs`，让 AI 回合显得是经过思考，而非瞬间落子。
 */
export class AiController<S, M> implements PlayerController<S, M> {
  readonly kind = "ai" as const;

  constructor(
    private readonly strategy: AiStrategy<S, M>,
    readonly difficulty: Difficulty,
    private readonly minThinkMs = 700,
  ) {}

  async requestMove(ctx: MoveRequestContext<S>): Promise<M> {
    const startedAt = performance.now();
    const move = await this.strategy.chooseMove(
      ctx.state,
      ctx.seat,
      this.difficulty,
      ctx.signal,
    );
    const remaining = this.minThinkMs - (performance.now() - startedAt);
    if (remaining > 0) await abortableDelay(remaining, ctx.signal);
    return move;
  }
}

/**
 * 处理来自网络的走法。联机会话通过 `push` 把对手走法推入；
 * 对局循环的 `requestMove` 按到达顺序消费它们（TCP 保序）。
 * `fail` 会让控制器失效，使断连表现为对局错误，而非无限挂起。
 */
export class RemoteController<S, M> implements PlayerController<S, M> {
  readonly kind = "remote" as const;

  private queue: M[] = [];
  private failure: unknown = null;
  private waiter: {
    resolve: (move: M) => void;
    reject: (reason: unknown) => void;
    cleanup: () => void;
  } | null = null;

  requestMove(ctx: MoveRequestContext<S>): Promise<M> {
    if (this.failure !== null) return Promise.reject(this.failure);
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    this.cancelWaiter(new DOMException("Superseded", "AbortError"));
    return new Promise<M>((resolve, reject) => {
      const onAbort = () => {
        this.waiter = null;
        reject(ctx.signal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      this.waiter = {
        resolve,
        reject,
        cleanup: () => ctx.signal.removeEventListener("abort", onAbort),
      };
    });
  }

  /** 喂入从对手收到的走法。 */
  push(move: M): void {
    const waiter = this.waiter;
    if (waiter) {
      this.waiter = null;
      waiter.cleanup();
      waiter.resolve(move);
    } else {
      this.queue.push(move);
    }
  }

  /** 令控制器失效：待处理和未来的请求都会 reject。 */
  fail(reason: unknown): void {
    this.failure = reason;
    const waiter = this.waiter;
    if (waiter) {
      this.waiter = null;
      waiter.cleanup();
      waiter.reject(reason);
    }
  }

  dispose(): void {
    this.cancelWaiter(new DOMException("Disposed", "AbortError"));
  }

  private cancelWaiter(reason: unknown): void {
    const waiter = this.waiter;
    if (!waiter) return;
    this.waiter = null;
    waiter.cleanup();
    waiter.reject(reason);
  }
}

export type AnyController<S, M> =
  LocalController<S, M> | AiController<S, M> | RemoteController<S, M>;

export function isLocalSeat<S, M>(
  controllers: readonly PlayerController<S, M>[],
  seat: SeatIndex | null,
): boolean {
  return seat !== null && controllers[seat]?.kind === "local";
}
