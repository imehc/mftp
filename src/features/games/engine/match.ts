/**
 * MatchRunner drives a turn-based match: it repeatedly asks the active
 * seat's controller for a move, applies it through the game's
 * deterministic resolver, waits for the UI to play the presentation
 * back, and advances. Every post-move state is kept, so `undo(plies)`
 * can rewind any game for free. React components observe it through
 * `useMatchSnapshot` (useSyncExternalStore), keeping per-frame rendering
 * (Pixi) out of the React update cycle.
 */
import { useSyncExternalStore } from "react";
import type {
  GameDefinition,
  MatchPhase,
  MoveResolution,
  PlayerController,
  SeatIndex,
} from "./types";

export interface MoveResolvedInfo<S, M, P> {
  seat: SeatIndex;
  move: M;
  moveIndex: number;
  resolution: MoveResolution<S, P>;
}

export interface MatchHooks<S, M, P> {
  /**
   * Awaited between applying a move and starting the next turn — play
   * the move's presentation (animation/audio) here.
   */
  onMoveResolved?(info: MoveResolvedInfo<S, M, P>): void | Promise<void>;
  onError?(error: unknown): void;
}

export interface MatchSnapshot<S> {
  state: S;
  phase: MatchPhase;
  activeSeat: SeatIndex | null;
  winnerSeat: SeatIndex | null;
  moveCount: number;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export class MatchRunner<S, M, P = unknown> {
  private readonly listeners = new Set<() => void>();
  private readonly abortController = new AbortController();
  /** `history[i]` is the state after i moves; `history[0]` the initial. */
  private readonly history: S[];
  /** Bumped by undo() so in-flight move requests are recognised as stale. */
  private epoch = 0;
  /** Abort scope of the turn currently awaiting a move, if any. */
  private turnAbort: AbortController | null = null;
  private snapshot: MatchSnapshot<S>;
  private started = false;

  constructor(
    readonly game: GameDefinition<S, M, P>,
    initialState: S,
    readonly controllers: readonly PlayerController<S, M>[],
    private readonly hooks: MatchHooks<S, M, P> = {},
  ) {
    if (controllers.length !== game.seatCount) {
      throw new Error(
        `${game.id}: expected ${game.seatCount} controllers, got ${controllers.length}`,
      );
    }
    this.history = [initialState];
    this.snapshot = this.buildSnapshot(initialState, 0);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.loop();
  }

  dispose(): void {
    this.abortController.abort(new DOMException("Disposed", "AbortError"));
    for (const controller of this.controllers) controller.dispose?.();
  }

  /**
   * Rewind the match by `plies` moves. Allowed while a move is being
   * awaited — including an AI turn, whose in-flight request is cancelled
   * and, should it resolve anyway, discarded. Rejected mid-resolution and
   * once the match is finished. Online play will call this on both peers
   * after the opponent consents.
   */
  undo(plies: number): boolean {
    if (plies <= 0 || this.snapshot.phase !== "awaiting-move") return false;
    const moveCount = this.history.length - 1;
    if (plies > moveCount) return false;
    this.history.length = moveCount - plies + 1;
    this.epoch++;
    this.publish(
      this.buildSnapshot(this.history[this.history.length - 1], moveCount - plies),
    );
    this.turnAbort?.abort(new DOMException("Superseded", "AbortError"));
    return true;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MatchSnapshot<S> => this.snapshot;

  private buildSnapshot(state: S, moveCount: number): MatchSnapshot<S> {
    const finished = this.game.isFinished(state);
    return {
      state,
      phase: finished ? "finished" : "awaiting-move",
      activeSeat: finished ? null : this.game.currentSeat(state),
      winnerSeat: this.game.winnerSeat(state),
      moveCount,
    };
  }

  private publish(snapshot: MatchSnapshot<S>): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private async loop(): Promise<void> {
    const { signal } = this.abortController;
    try {
      while (!signal.aborted && this.snapshot.phase !== "finished") {
        const { state, moveCount } = this.snapshot;
        const seat = this.game.currentSeat(state);
        if (seat === null) break;

        // Each turn gets its own abort scope so undo() can cancel the
        // pending request without tearing down the match. The epoch guard
        // additionally discards a move that resolves after an undo — a
        // controller may ignore the abort signal and complete anyway.
        const turnEpoch = this.epoch;
        const turnAbort = new AbortController();
        const forwardAbort = () => turnAbort.abort(signal.reason);
        signal.addEventListener("abort", forwardAbort, { once: true });
        this.turnAbort = turnAbort;
        let move: M;
        try {
          move = await this.controllers[seat].requestMove({
            state,
            seat,
            signal: turnAbort.signal,
          });
        } catch (error) {
          if (signal.aborted) return;
          if (turnEpoch !== this.epoch) continue;
          throw error;
        } finally {
          this.turnAbort = null;
          signal.removeEventListener("abort", forwardAbort);
        }
        if (signal.aborted) return;
        if (turnEpoch !== this.epoch) continue;

        this.publish({ ...this.snapshot, phase: "resolving" });
        const resolution = await this.game.applyMove(state, move, seat);
        if (signal.aborted) return;

        await this.hooks.onMoveResolved?.({
          seat,
          move,
          moveIndex: moveCount,
          resolution,
        });
        if (signal.aborted) return;

        this.history.push(resolution.state);
        this.publish(this.buildSnapshot(resolution.state, moveCount + 1));
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      this.hooks.onError?.(error);
      this.publish({ ...this.snapshot, phase: "finished", activeSeat: null });
    }
  }
}

export function useMatchSnapshot<S, M, P>(
  runner: MatchRunner<S, M, P>,
): MatchSnapshot<S> {
  return useSyncExternalStore(runner.subscribe, runner.getSnapshot);
}
