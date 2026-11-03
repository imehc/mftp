import type { Difficulty } from "../engine/ai";
import type { BoardMode } from "../engine/board-session";
import type { LocalGameInput } from "../engine/game-session-store";
import type { MatchHandle } from "../engine/match-handle";

export const REVERSI_GAME_ID = "reversi";
export const BOARD_SIZE = 8;

export type Stone = 0 | 1 | null;

export interface ReversiMove {
  row: number;
  col: number;
}

export interface ReversiState {
  board: Stone[];
  turnSeat: number;
  winnerSeat: number | null;
  finished: boolean;
  moveCount: number;
  lastMove: (ReversiMove & { seat: number }) | null;
  passedSeat: number | null;
}

export interface ReversiPresentation extends ReversiMove {
  flipped: number[];
}

export type ReversiMode = BoardMode;

export interface ReversiHistoryPayload {
  mode: ReversiMode["kind"];
  difficulty?: Difficulty;
  winnerSeat: number | null;
  moves: number;
  localSeat?: number;
  black: number;
  white: number;
}

export interface ReversiSession {
  runner: MatchHandle<ReversiState, ReversiMove>;
  local: LocalGameInput<ReversiMove>;
}
