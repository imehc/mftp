import type { Difficulty } from "../engine/ai";
import type { LocalController } from "../engine/controllers";
import type { MatchRunner } from "../engine/match";
import type { SeatIndex } from "../engine/types";

export const GO_GAME_ID = "go";

export const BOARD_SIZES = [9, 13, 19] as const;
export type BoardSize = (typeof BOARD_SIZES)[number];
export const DEFAULT_BOARD_SIZE: BoardSize = 19;

/** 中国规则的贴目。直接比较目数时，白方总共多得 7.5 目。 */
export const KOMI = 7.5;

export type Stone = SeatIndex | null;

/** 落子，或停手。连续两次停手则对局结束。 */
export type GoMove =
  { kind: "play"; row: number; col: number } | { kind: "pass" };

export interface GoState {
  boardSize: BoardSize;
  board: Stone[];
  turnSeat: SeatIndex;
  /** 本回合禁止落子的交叉点（单官劫），否则为 null。 */
  koPoint: number | null;
  captures: [number, number];
  consecutivePasses: number;
  /** 每次落子后的棋盘局面，用于中国规则的超级劫（禁止全局同形
   *  重复）。停手不计入。 */
  positionHistory: string[];
  finished: boolean;
  winnerSeat: SeatIndex | null;
  /** 对局结束后各方地域（己方棋子 + 围住的空点），否则为 null。 */
  finalScore: [number, number] | null;
  moveCount: number;
  lastMove: GoMove | null;
  /** 上一手被提掉的棋子（索引 + 座位），用于动画。 */
  lastCaptured: Array<{ index: number; seat: SeatIndex }>;
}

/** 落子后由舞台回放的内容。 */
export interface GoPresentation {
  move: GoMove;
  captured: Array<{ index: number; seat: SeatIndex }>;
}

export type GoMode =
  | {
      kind: "ai";
      difficulty: Difficulty;
      localSeat: SeatIndex;
      boardSize: BoardSize;
    }
  | { kind: "hotseat"; boardSize: BoardSize }
  | { kind: "online"; boardSize: BoardSize };

export interface GoHistoryPayload {
  mode: GoMode["kind"];
  difficulty?: Difficulty;
  boardSize: BoardSize;
  winnerSeat: SeatIndex | null;
  moves: number;
  score?: [number, number];
  localSeat?: SeatIndex;
}

/** 一局对战：runner 加上本地输入喂入的 controller。 */
export interface GoSession {
  runner: MatchRunner<GoState, GoMove, GoPresentation>;
  local: LocalController<GoState, GoMove>;
}
