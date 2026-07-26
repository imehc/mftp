/**
 * PlayerController implementations. The match loop treats every seat the
 * same way; these classes adapt UI input and AI strategies (and, in phase
 * 3, remote peers) to that contract.
 */
import { abortableDelay, type AiStrategy, type Difficulty } from "./ai";
import type {
  MoveRequestContext,
  PlayerController,
  SeatIndex,
} from "./types";

/**
 * Bridges UI input into the match loop: `requestMove` parks a promise
 * that the game screen resolves by calling `submit(move)` once the
 * player has committed an action.
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

  /** True while the match loop is waiting on this controller. */
  get awaitingInput(): boolean {
    return this.pending !== null;
  }

  /** Commit the player's move; returns false if no move was requested. */
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
 * Runs a game-supplied AiStrategy at a fixed difficulty. Pads very fast
 * searches to `minThinkMs` so AI turns read as deliberate instead of
 * instantaneous.
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
 * Resolves moves that arrive from the network. The online session pushes
 * peer moves in with `push`; the match loop's `requestMove` consumes them
 * in arrival order (TCP keeps them ordered). `fail` poisons the
 * controller so a dropped connection surfaces as a match error instead of
 * an eternal hang.
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

  /** Feed a move received from the peer. */
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

  /** Poison the controller: pending and future requests reject. */
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
  | LocalController<S, M>
  | AiController<S, M>
  | RemoteController<S, M>;

export function isLocalSeat<S, M>(
  controllers: readonly PlayerController<S, M>[],
  seat: SeatIndex | null,
): boolean {
  return seat !== null && controllers[seat]?.kind === "local";
}
