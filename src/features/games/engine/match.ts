/**
 * MatchRunner 驱动一场回合制对局：反复向当前座位的控制器索取
 * 走法，借由游戏确定性解析器应用它，等待 UI 回放表现，再推进。
 * 每一步之后的状态都会保留，因此 `undo(plies)` 能零成本地回退任意
 * 对局。React 组件通过 `useMatchSnapshot`（useSyncExternalStore）
 * 观察它，从而把逐帧渲染（Pixi）隔离在 React 更新周期之外。
 */
import { useSyncExternalStore } from "react";

import {
  TaskInterruption,
  type TaskInterruptionSource,
} from "~/lib/task-interruption";

import type { MatchHandle } from "./match-handle";
import { type GameOutcome, singleWinnerSeat } from "./outcome";
import {
  type ParticipantConfiguration,
  type ParticipantSummary,
  validateParticipants,
  validateSeat,
} from "./participants";
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

export interface MatchHooks<S, M, P, O = S> {
  onCheckpoint?(history: readonly S[]): void;
  /**
   * 在应用走法与开始下一回合之间被等待 —— 在此播放该步的
   * 表现（动画 / 音效）。
   */
  onMoveResolved?(info: MoveResolvedInfo<O, M, P>): void | Promise<void>;
  onError?(error: unknown): void;
}

export interface MatchSnapshot<S> {
  /** 此处是绑定座位的观察，不是权威规则状态。 */
  readonly state: S;
  readonly phase: MatchPhase;
  readonly activeSeat: SeatIndex | null;
  readonly winnerSeat: SeatIndex | null;
  readonly moveCount: number;
  readonly outcome: GameOutcome | null;
  readonly viewerSeat: SeatIndex;
  readonly participants: readonly ParticipantSummary[];
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export class MatchRunner<S, M, P = unknown, O = S> {
  private readonly listeners = new Set<() => void>();
  private readonly abortController = new AbortController();
  /** `history[i]` 是第 i 步之后的状态；`history[0]` 为初始状态。 */
  private readonly history: S[];
  /** 由 undo() 递增，使进行中的走法请求被识别为过期。 */
  private epoch = 0;
  /** 当前正在等待走法的回合的取消作用域（如有）。 */
  private turnAbort: AbortController | null = null;
  private snapshot: MatchSnapshot<O>;
  private projectedState: S;
  private readonly configuration?: ParticipantConfiguration;
  private readonly seatSnapshots = new Map<SeatIndex, MatchSnapshot<O>>();
  private started = false;
  private paused = false;
  private wake: (() => void) | null = null;
  readonly id: string;

  constructor(
    private readonly game: GameDefinition<S, M, P, O>,
    initialState: S,
    readonly controllers: readonly PlayerController<O, M>[],
    private readonly hooks: MatchHooks<S, M, P, O> = {},
    checkpoint?: { id: string; history?: readonly S[] },
    configuration?: ParticipantConfiguration,
  ) {
    if (controllers.length !== game.seatCount) {
      throw new Error(
        `${game.id}: expected ${game.seatCount} controllers, got ${controllers.length}`,
      );
    }
    if (
      !Number.isSafeInteger(game.seatCount) ||
      game.seatCount < 1 ||
      game.seatCount > 64
    )
      throw new Error("Invalid game seat count");
    if (!Number.isSafeInteger(game.version) || game.version < 1)
      throw new Error("Invalid game rules version");
    if (configuration) validateParticipants(configuration, game.seatCount);
    this.configuration = configuration
      ? structuredClone(configuration)
      : undefined;
    this.id = checkpoint?.id ?? crypto.randomUUID();
    this.history = structuredClone([
      ...(checkpoint?.history ?? [initialState]),
    ]);
    if (!this.history.length)
      throw new Error("Game checkpoint history is empty");
    this.projectedState = this.history[this.history.length - 1];
    this.snapshot = this.buildSnapshot(
      this.history[this.history.length - 1],
      this.history.length - 1,
    );
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.loop();
  }

  get hasStarted(): boolean {
    return this.started;
  }

  get rulesVersion(): number {
    return this.game.version;
  }

  dispose(): void {
    if (this.abortController.signal.aborted) return;
    this.abortController.abort(new TaskInterruption("sessionDisposed"));
    this.wake?.();
    for (const controller of this.controllers) controller.dispose?.();
  }

  pause(cancelRemote = false, source: TaskInterruptionSource = "paused"): void {
    this.paused = true;
    const seat = this.snapshot.activeSeat;
    if (
      this.snapshot.phase === "awaiting-move" &&
      seat !== null &&
      (cancelRemote || this.controllers[seat]?.kind !== "remote") &&
      this.controllers[seat]?.awaitingInput !== false
    ) {
      this.epoch++;
      this.turnAbort?.abort(new TaskInterruption(source));
    }
  }

  resume(): void {
    this.paused = false;
    this.wake?.();
    this.wake = null;
  }

  /** 仅供权威端存档和协议适配使用，不进入参与者快照。 */
  getAuthorityState(): S {
    return structuredClone(this.history[this.history.length - 1]);
  }

  getAuthorityCheckpoint(): readonly S[] {
    return structuredClone(this.history);
  }

  /** 悔棋菜单只读取本座位的历史观察，不获得权威历史。 */
  getObservationHistory(): readonly O[] {
    return this.history.map((state) =>
      structuredClone(this.game.observe(state, this.snapshot.viewerSeat)),
    );
  }

  getAuthorityConfiguration(): ParticipantConfiguration | undefined {
    return this.configuration ? structuredClone(this.configuration) : undefined;
  }

  /** 同屏轮流也按当前座位提交，不把一个输入控制器复用给所有人。 */
  submitLocal(move: M): boolean {
    const seat = this.snapshot.activeSeat;
    if (seat === null || this.snapshot.phase !== "awaiting-move" || this.paused)
      return false;
    if (seat !== this.snapshot.viewerSeat) return false;
    const controller = this.controllers[seat];
    return controller.kind === "local" &&
      "submit" in controller &&
      typeof controller.submit === "function"
      ? controller.submit(move)
      : false;
  }

  get awaitingLocalInput(): boolean {
    const seat = this.snapshot.activeSeat;
    return (
      seat !== null &&
      seat === this.snapshot.viewerSeat &&
      this.controllers[seat].kind === "local" &&
      this.controllers[seat].awaitingInput === true
    );
  }

  /**
   * 回退 `plies` 步。允许在等待走法时进行 —— 包括电脑回合，其
   * 进行中的请求会被取消，且即便它仍解析成功也会被丢弃。在解析
   * 中途或已结束时会被拒绝。联机对战会在对方同意后在双方都调用它。
   */
  undo(plies: number): boolean {
    if (
      !Number.isSafeInteger(plies) ||
      plies <= 0 ||
      this.snapshot.phase !== "awaiting-move"
    )
      return false;
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
    this.turnAbort?.abort(new TaskInterruption("positionChanged"));
    this.hooks.onCheckpoint?.(this.getAuthorityCheckpoint());
    return true;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MatchSnapshot<O> => this.snapshot;

  getSeatSnapshot = (seat: SeatIndex): MatchSnapshot<O> => {
    validateSeat(seat, this.game.seatCount);
    const cached = this.seatSnapshots.get(seat);
    if (cached) return cached;
    const snapshot = Object.freeze({
      ...this.snapshot,
      viewerSeat: seat,
      state: structuredClone(this.game.observe(this.projectedState, seat)),
    });
    this.seatSnapshots.set(seat, snapshot);
    return snapshot;
  };

  private buildSnapshot(state: S, moveCount: number): MatchSnapshot<O> {
    const finished = this.game.isFinished(state);
    const activeSeat = finished ? null : this.game.currentSeat(state);
    if (activeSeat !== null) validateSeat(activeSeat, this.game.seatCount);
    const viewerSeat =
      this.configuration?.viewerSeat === "active"
        ? (activeSeat ?? this.snapshot?.viewerSeat ?? 0)
        : (this.configuration?.viewerSeat ?? 0);
    const outcome = structuredClone(this.game.outcome(state));
    this.projectedState = state;
    return Object.freeze({
      state: structuredClone(this.game.observe(state, viewerSeat)),
      phase: finished ? "finished" : "awaiting-move",
      activeSeat,
      winnerSeat: singleWinnerSeat(outcome),
      moveCount,
      outcome,
      viewerSeat,
      participants: this.controllers.map((controller, seat) => ({
        seat,
        kind: controller.kind,
        ...(this.configuration?.seats.find((entry) => entry.seat === seat)
          ?.teamId !== undefined
          ? {
              teamId: this.configuration.seats.find(
                (entry) => entry.seat === seat,
              )?.teamId,
            }
          : {}),
      })),
    });
  }

  private publish(snapshot: MatchSnapshot<O>): void {
    this.snapshot = Object.freeze(snapshot);
    this.seatSnapshots.clear();
    for (const listener of this.listeners) listener();
  }

  private async loop(): Promise<void> {
    const { signal } = this.abortController;
    try {
      while (!signal.aborted && this.snapshot.phase !== "finished") {
        while (this.paused && !signal.aborted)
          await new Promise<void>((resolve) => {
            this.wake = resolve;
          });
        if (signal.aborted) return;
        const { moveCount } = this.snapshot;
        const state = this.history[this.history.length - 1];
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
            observation: structuredClone(this.game.observe(state, seat)),
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

        this.history.push(resolution.state);
        this.hooks.onCheckpoint?.(this.getAuthorityCheckpoint());

        await this.hooks.onMoveResolved?.({
          seat,
          move,
          moveIndex: moveCount,
          resolution: {
            state: structuredClone(
              this.game.observe(resolution.state, this.snapshot.viewerSeat),
            ),
            presentation: resolution.presentation,
          },
        });
        if (signal.aborted) return;

        this.publish(this.buildSnapshot(resolution.state, moveCount + 1));
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      this.hooks.onError?.(error);
      this.publish({
        ...this.buildSnapshot(
          this.history[this.history.length - 1],
          this.history.length - 1,
        ),
        phase: "finished",
        activeSeat: null,
      });
    }
  }
}

export function useMatchSnapshot<O>(
  runner: Pick<MatchHandle<O, unknown>, "subscribe" | "getSnapshot">,
): MatchSnapshot<O> {
  return useSyncExternalStore(runner.subscribe, runner.getSnapshot);
}
