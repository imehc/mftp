import type { Difficulty } from "../engine/ai";
import type { LocalController } from "../engine/controllers";
import type { MatchRunner } from "../engine/match";
import type { SeatIndex } from "../engine/types";

export const GOMOKU_GAME_ID = "gomoku";

export const BOARD_SIZE = 15;
export const WIN_LENGTH = 5;

export type Stone = SeatIndex | null;

export interface GomokuMove {
  row: number;
  col: number;
}

export interface GomokuState {
  board: Stone[];
  turnSeat: SeatIndex;
  winnerSeat: SeatIndex | null;
  winningLine: number[];
  finished: boolean;
  moveCount: number;
  lastMove: GomokuMove | null;
}

export interface GomokuPresentation {
  row: number;
  col: number;
}

export type GomokuMode =
  | { kind: "ai"; difficulty: Difficulty; localSeat: SeatIndex }
  | { kind: "hotseat" }
  | { kind: "online" };

export interface GomokuHistoryPayload {
  mode: GomokuMode["kind"];
  difficulty?: Difficulty;
  winnerSeat: SeatIndex | null;
  moves: number;
  /** 本地玩家的座位（存在时）：人机为 0，联机不定。 */
  localSeat?: SeatIndex;
}

/** 一局对战：runner 加上本地输入喂入的 controller。 */
export interface GomokuSession {
  runner: MatchRunner<GomokuState, GomokuMove, GomokuMove>;
  local: LocalController<GomokuState, GomokuMove>;
}
