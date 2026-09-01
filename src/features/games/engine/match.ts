/**
 * MatchRunner 驱动一场回合制对局：反复向当前座位的控制器索取
 * 走法，借由游戏确定性解析器应用它，等待 UI 回放表现，再推进。
 * 每一步之后的状态都会保留，因此 `undo(plies)` 能零成本地回退任意
 * 对局。React 组件通过 `useMatchSnapshot`（useSyncExternalStore）
 * 观察它，从而把逐帧渲染（Pixi）隔离在 React 更新周期之外。
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
   * 在应用走法与开始下一回合之间被等待 —— 在此播放该步的
   * 表现（动画 / 音效）。
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
  /** `history[i]` 是第 i 步之后的状态；`history[0]` 为初始状态。 */
  private readonly history: S[];
  /** 由 undo() 递增，使进行中的走法请求被识别为过期。 */
  private epoch = 0;
  /** 当前正在等待走法的回合的取消作用域（如有）。 */
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
   * 回退 `plies` 步。允许在等待走法时进行 —— 包括 AI 回合，其
   * 进行中的请求会被取消，且即便它仍解析成功也会被丢弃。在解析
   * 中途或已结束时会被拒绝。联机对战会在对方同意后在双方都调用它。
   */
  undo(plies: number): boolean {
    if (plies <= 0 || this.snapshot.phase !== "awaiting-move") return false;
    const moveCount = this.history.length - 1;
    if (plies > moveCount) return false;
    this.history.length = moveCount - plies + 1;
    this.epoch++;
    this.publish(
      this.buildSnapshot(
        this.history[this.history.length - 1],
        moveCount - plies,
      ),
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

        // 每个回合拥有独立的取消作用域，使 undo() 能取消待处理请求
        // 而不拆掉整场对局。epoch 守卫还会额外丢弃在 undo 之后才解析出的
        // 走法 —— 控制器可能忽略中止信号而仍完成。
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
