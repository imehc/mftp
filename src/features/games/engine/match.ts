/**
 * MatchRunner drives a turn-based match: it repeatedly asks the active
 * seat's controller for a move, applies it through the game's
 * deterministic resolver, waits for the UI to play the presentation
 * back, and advances. React components observe it through
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

        const move = await this.controllers[seat].requestMove({
          state,
          seat,
          signal,
        });
        if (signal.aborted) return;

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
