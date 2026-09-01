/** 台球特有的状态、走子与呈现类型。 */
import type { Difficulty } from "../engine/ai";
import type { SeatIndex } from "../engine/types";

export const BILLIARDS_GAME_ID = "billiards";

export type BilliardsMode =
  | { kind: "practice" }
  | { kind: "ai"; difficulty: Difficulty; playerBreaks: boolean }
  | { kind: "hotseat" };

export interface BilliardsHistoryPayload {
  mode: BilliardsMode["kind"];
  difficulty?: Difficulty;
  winnerSeat: number | null;
  shots: number;
  fouls: number[];
}

export type BilliardsVariant = "eight-ball" | "practice";
export type BallGroup = "solids" | "stripes";

/** 球 id：0 = 母球，1-7 全色，8 = 黑八，9-15 花色。 */
export interface BallState {
  id: number;
  x: number;
  y: number;
  potted: boolean;
}

export type FoulReason =
  "cue-potted" | "no-contact" | "wrong-first-contact" | "potted-eight-early";

export interface ShotOutcome {
  foul: FoulReason | null;
  /** 本杆落袋的球 id，按进袋顺序（不含母球）。 */
  potted: number[];
  /** 击球方下一杆继续留在台上。 */
  continueTurn: boolean;
  /** 开球时黑八落袋并被放回脚点。 */
  respottedEight: boolean;
}

export interface BilliardsState {
  variant: BilliardsVariant;
  balls: BallState[];
  turnSeat: SeatIndex;
  /** 每个座位的已分配组别；球桌“封闭”前为 null。 */
  groups: (BallGroup | null)[];
  openTable: boolean;
  breakDone: boolean;
  ballInHand: boolean;
  winnerSeat: SeatIndex | null;
  finished: boolean;
  /** 迄今已出杆数（不含母球放置）。 */
  shotCount: number;
  /** 每个座位累计的犯规数，用于结算界面。 */
  foulCounts: number[];
  /** 上一杆的判定结果，用于 HUD 提示。 */
  lastOutcome: ShotOutcome | null;
}

export type BilliardsMove =
  | {
      type: "shot";
      /** 瞄准角（弧度，台面坐标系）。 */
      angle: number;
      /** 0..1，映射到 MAX_SHOT_SPEED。 */
      power: number;
      /** 跟杆/缩杆旋转：-1（缩杆）.. 1（跟杆）。 */
      followDraw: number;
    }
  | { type: "place-cue"; x: number; y: number };

/** 一步被记录的模拟（每颗未落袋球的位置）。 */
export interface SimFrame {
  /** 自击球起的模拟时间（秒）。 */
  t: number;
  /** 扁平的 [id, x, y, ...] 三元组——足够紧凑，可按步记录。 */
  balls: number[];
}

export type SimEvent =
  | { type: "ball-ball"; t: number; a: number; b: number; impact: number }
  | { type: "cushion"; t: number; ball: number; impact: number }
  | { type: "pocket"; t: number; ball: number; pocket: number };

export interface BilliardsPresentation {
  frames: SimFrame[];
  events: SimEvent[];
}

export function ballGroup(id: number): BallGroup | "eight" | "cue" {
  if (id === 0) return "cue";
  if (id === 8) return "eight";
  return id < 8 ? "solids" : "stripes";
}

export function remainingGroupBalls(
  state: BilliardsState,
  group: BallGroup,
): number {
  return state.balls.filter(
    (ball) =>
      !ball.potted &&
      ball.id !== 0 &&
      ball.id !== 8 &&
      ballGroup(ball.id) === group,
  ).length;
}
