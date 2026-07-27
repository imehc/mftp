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
  /** Local player's seat where one exists (ai: 0, online: varies). */
  localSeat?: SeatIndex;
}

/** A live match: the runner plus the controller local input feeds into. */
export interface GomokuSession {
  runner: MatchRunner<GomokuState, GomokuMove, GomokuMove>;
  local: LocalController<GomokuState, GomokuMove>;
}
