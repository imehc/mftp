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
 * Phase 3 placeholder: a controller that resolves moves from a
 * MatchTransport (see transport.ts). Declared now so game screens can be
 * written against the full controller union.
 */
export class RemoteController<S, M> implements PlayerController<S, M> {
  readonly kind = "remote" as const;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  requestMove(_ctx: MoveRequestContext<S>): Promise<M> {
    return Promise.reject(
      new Error("Online play is not implemented yet (phase 3)"),
    );
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
