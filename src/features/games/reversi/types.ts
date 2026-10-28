import type { Difficulty } from "../engine/ai";
import type { LocalController } from "../engine/controllers";
import type { MatchRunner } from "../engine/match";

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

export type ReversiMode =
  | { kind: "ai"; difficulty: Difficulty; localSeat: number }
  | { kind: "hotseat" }
  | { kind: "online" };

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
  runner: MatchRunner<ReversiState, ReversiMove, ReversiPresentation>;
  local: LocalController<ReversiState, ReversiMove>;
}
