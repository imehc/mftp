import type { SeatIndex } from "../engine/types";

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
