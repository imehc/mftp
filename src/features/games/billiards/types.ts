/** 台球特有的状态、走子与呈现类型。 */
import type { Difficulty } from "../engine/ai";
import type { SeatIndex } from "../engine/types";

export const BILLIARDS_GAME_ID = "billiards";

export type BilliardsDiscipline = "eight-ball" | "nine-ball" | "snooker";

export type RedCount = 6 | 10 | 15;

export type BilliardsMode = (
  | { kind: "practice" }
  | { kind: "ai"; difficulty: Difficulty; playerBreaks: boolean }
  | { kind: "hotseat"; firstSeat?: SeatIndex }
) &
  (
    | { discipline?: "eight-ball" | "nine-ball" }
    | { discipline: "snooker"; reds: RedCount }
  );

export interface BilliardsHistoryPayload {
  version?: 2;
  discipline?: BilliardsDiscipline;
  mode: BilliardsMode["kind"];
  difficulty?: Difficulty;
  winnerSeat: number | null;
  shots: number;
  fouls: number[];
  reds?: RedCount;
  scores?: number[];
  highestBreaks?: number[];
}

export type BilliardsVariant = BilliardsDiscipline | "practice";

export type BallGroup = "solids" | "stripes";

/** id是稳定标识；颜色/编号/分值由BallDefinition决定，不能跨玩法推断。 */
export interface BallState {
  id: number;
  x: number;
  y: number;
  potted: boolean;
}

export type FoulReason =
  | "cue-potted"
  | "no-contact"
  | "wrong-first-contact"
  | "potted-eight-early"
  | "no-rail"
  | "illegal-break"
  | "wrong-ball-potted"
  | "touching-ball-moved"
  | "snooker-behind-nomination";

export interface ShotOutcome {
  foul: FoulReason | null;
  /** 本杆落袋的球 id，按进袋顺序（不含母球）。 */
  potted: number[];
  /** 击球方下一杆继续留在台上。 */
  continueTurn: boolean;
  /** 开球时黑八落袋并被放回脚点。 */
  respottedEight: boolean;
  respottedNine?: boolean;
}

export interface BaseBilliardsState {
  balls: BallState[];
  turnSeat: SeatIndex;
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

export interface EightBallState extends BaseBilliardsState {
  variant: "eight-ball" | "practice";
  /** 每个座位的已分配组别；球桌“封闭”前为 null。 */
  groups: (BallGroup | null)[];
  openTable: boolean;
  /** 练习可使用其他器材与球组，不套用其对战规则。 */
  discipline?: BilliardsDiscipline;
  reds?: RedCount;
}

export type NineBallDecision =
  | { kind: "push-out" | "illegal-break"; seat: SeatIndex; shooter: SeatIndex }
  | { kind: "warning"; seat: SeatIndex }
  | { kind: "stalemate"; seat: SeatIndex; proposer: SeatIndex };

export interface NineBallState extends BaseBilliardsState {
  variant: "nine-ball";
  rackSeed: number;
  breaker: SeatIndex;
  placementRegion: "head" | "table" | null;
  pushOutAvailable: boolean;
  consecutiveFouls: number[];
  warned: boolean[];
  decision: NineBallDecision | null;
}

export type SnookerOn =
  | { kind: "red" }
  | { kind: "color"; nominated: number | null }
  | { kind: "clearance"; color: number };

export interface SnookerPosition {
  balls: BallState[];
  on: SnookerOn;
  placementRegion: "d" | "table" | null;
  freeBall: boolean;
  nominatedFree: number | null;
}

export interface MissRun {
  shooter: SeatIndex;
  count: number;
  fullBallFailures: number;
  warned: boolean;
  sixWarned: boolean;
}

export type SnookerDecision =
  | {
      kind: "foul";
      seat: SeatIndex;
      shooter: SeatIndex;
      replace: SnookerPosition | null;
      anywhere: boolean;
      warning: "three-miss" | "six-red" | null;
    }
  | { kind: "black-choice"; seat: SeatIndex };

export interface SnookerState extends BaseBilliardsState, SnookerPosition {
  variant: "snooker";
  reds: RedCount;
  frameSeed: number;
  scores: number[];
  currentBreak: number;
  highestBreaks: number[];
  decision: SnookerDecision | null;
  missRun: MissRun | null;
  lastScore: {
    points: number;
    penalty: number;
    miss: boolean;
    respotted: number[];
  } | null;
  respottedBlack: boolean;
}

export type BilliardsState = EightBallState | NineBallState | SnookerState;

export type BilliardsMove =
  | {
      type: "shot";
      /** 瞄准角（弧度，台面坐标系）。 */
      angle: number;
      /** 0..1，映射到 MAX_SHOT_SPEED。 */
      power: number;
      /** 跟杆/缩杆旋转：-1（缩杆）.. 1（跟杆）。 */
      followDraw: number;
      /** 推杆声明与实际出杆原子提交。 */
      pushOut?: boolean;
    }
  | { type: "place-cue"; x: number; y: number }
  | { type: "reposition-cue" }
  | {
      type: "decision";
      choice:
        | "accept"
        | "return"
        | "acknowledge"
        | "rerack"
        | "decline"
        | "replace"
        | "anywhere";
    }
  | { type: "propose-stalemate" }
  | { type: "nominate"; ballId: number }
  | { type: "nominate-free"; ballId: number | null }
  | { type: "concede" }
  | { type: "claim-frame" };

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
  | {
      type: "pocket";
      t: number;
      ball: number;
      pocket: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
    };

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
  state: EightBallState,
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
