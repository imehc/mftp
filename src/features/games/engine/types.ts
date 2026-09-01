/**
 * 与具体游戏无关的回合制对局框架。
 *
 * 游戏通过实现 `GameDefinition`（纯函数、确定性的状态 + 走法解析），
 * 以及可选的 `AiStrategy`（见 ai.ts）接入。每一步走法由谁产生 ——
 * 本地玩家、AI 还是远端对手 —— 都被 `PlayerController`（见
 * controllers.ts）抽象掉，于是同一对局循环能驱动练习、人机、
 * 同屏轮流以及（将来的）联机对战。
 */

/** 对局内的座位下标，从 0 开始。 */
export type SeatIndex = number;

export type MatchPhase =
  /** 等待当前座位的控制器产出走法。 */
  | "awaiting-move"
  /** 走法正在应用 / 其表现回放中。 */
  | "resolving"
  | "finished";

/**
 * 应用一步走法的结果。
 *
 * `presentation` 携带游戏渲染器回放该步所需的全部内容（例如台球
 * 的物理帧时间线 + 撞击事件）。引擎从不会检查它。
 */
export interface MoveResolution<S, P> {
  state: S;
  presentation: P;
}

/**
 * 一个回合制游戏。实现必须是确定性的：相同的 (state, move, seat)
 * 永远得到相同的结果。正是这一性质让 AI 评估能复用实时解析器，
 * 也让联机对战只需交换走法即可同步。
 */
export interface GameDefinition<S, M, P = unknown> {
  id: string;
  seatCount: number;
  /** 轮到谁走；对局结束则为 null。 */
  currentSeat(state: S): SeatIndex | null;
  /** 结束后的获胜座位；进行中（或平局）为 null。 */
  winnerSeat(state: S): SeatIndex | null;
  isFinished(state: S): boolean;
  applyMove(
    state: S,
    move: M,
    seat: SeatIndex,
  ): MoveResolution<S, P> | Promise<MoveResolution<S, P>>;
}

export interface MoveRequestContext<S> {
  state: S;
  seat: SeatIndex;
  /** 对局被销毁（卸载 / 重开）时中止。 */
  signal: AbortSignal;
}

export type ControllerKind = "local" | "ai" | "remote";

/**
 * 为某个座位产出走法。每当该座位变为活跃，对局循环就等待
 * `requestMove`；实现从 UI 输入（LocalController）、策略搜索
 *（AiController）或网络（RemoteController，第三阶段）兑现它。
 */
export interface PlayerController<S, M> {
  readonly kind: ControllerKind;
  requestMove(ctx: MoveRequestContext<S>): Promise<M>;
  dispose?(): void;
}
