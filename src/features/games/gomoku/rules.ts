import type { GameDefinition, MoveResolution, SeatIndex } from "../engine/types";
import {
  BOARD_SIZE,
  WIN_LENGTH,
  type GomokuMove,
  type GomokuPresentation,
  type GomokuState,
  type Stone,
} from "./types";

const DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

export function cellIndex(row: number, col: number): number {
  return row * BOARD_SIZE + col;
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function createInitialGomokuState(): GomokuState {
  return {
    board: Array<Stone>(BOARD_SIZE * BOARD_SIZE).fill(null),
    turnSeat: 0,
    winnerSeat: null,
    winningLine: [],
    finished: false,
    moveCount: 0,
    lastMove: null,
  };
}

function collectLine(
  board: readonly Stone[],
  row: number,
  col: number,
  seat: SeatIndex,
  dr: number,
  dc: number,
): number[] {
  const line = [cellIndex(row, col)];
  for (const sign of [-1, 1]) {
    for (let step = 1; step < WIN_LENGTH; step++) {
      const nextRow = row + dr * step * sign;
      const nextCol = col + dc * step * sign;
      if (!inBounds(nextRow, nextCol)) break;
      const index = cellIndex(nextRow, nextCol);
      if (board[index] !== seat) break;
      if (sign < 0) line.unshift(index);
      else line.push(index);
    }
  }
  return line;
}

export function findWinningLine(
  board: readonly Stone[],
  move: GomokuMove,
  seat: SeatIndex,
): number[] {
  for (const [dr, dc] of DIRECTIONS) {
    const line = collectLine(board, move.row, move.col, seat, dr, dc);
    if (line.length >= WIN_LENGTH) return line.slice(0, WIN_LENGTH);
  }
  return [];
}

export function legalMoves(state: GomokuState): GomokuMove[] {
  if (state.finished) return [];
  const moves: GomokuMove[] = [];
  state.board.forEach((stone, index) => {
    if (stone !== null) return;
    moves.push({
      row: Math.floor(index / BOARD_SIZE),
      col: index % BOARD_SIZE,
    });
  });
  return moves;
}

export const gomokuGame: GameDefinition<
  GomokuState,
  GomokuMove,
  GomokuPresentation
> = {
  id: "gomoku",
  seatCount: 2,
  currentSeat: (state) => (state.finished ? null : state.turnSeat),
  winnerSeat: (state) => state.winnerSeat,
  isFinished: (state) => state.finished,
  applyMove(state, move, seat): MoveResolution<GomokuState, GomokuPresentation> {
    if (state.finished) throw new Error("gomoku: match already finished");
    if (seat !== state.turnSeat) throw new Error("gomoku: wrong seat");
    if (!inBounds(move.row, move.col)) throw new Error("gomoku: move out of bounds");
    const index = cellIndex(move.row, move.col);
    if (state.board[index] !== null) throw new Error("gomoku: cell occupied");

    const board = [...state.board];
    board[index] = seat;
    const winningLine = findWinningLine(board, move, seat);
    const draw = winningLine.length === 0 && state.moveCount + 1 === board.length;
    const finished = winningLine.length > 0 || draw;
    return {
      state: {
        board,
        turnSeat: finished ? state.turnSeat : 1 - state.turnSeat,
        winnerSeat: winningLine.length > 0 ? seat : null,
        winningLine,
        finished,
        moveCount: state.moveCount + 1,
        lastMove: move,
      },
      presentation: move,
    };
  },
};
