import type { GameDefinition, MoveResolution } from "../engine/types";
import {
  BOARD_SIZE,
  type ReversiMove,
  type ReversiPresentation,
  type ReversiState,
  type Stone,
} from "./types";

const DIRECTIONS = [-1, 0, 1].flatMap((row) =>
  [-1, 0, 1]
    .filter((col) => row !== 0 || col !== 0)
    .map((col) => [row, col] as const),
);

export function inBounds(row: number, col: number): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < BOARD_SIZE &&
    col >= 0 &&
    col < BOARD_SIZE
  );
}

export function cellIndex(row: number, col: number): number {
  return row * BOARD_SIZE + col;
}

export function createInitialReversiState(): ReversiState {
  const board = Array<Stone>(64).fill(null);
  board[27] = board[36] = 1;
  board[28] = board[35] = 0;
  return {
    board,
    turnSeat: 0,
    winnerSeat: null,
    finished: false,
    moveCount: 0,
    lastMove: null,
    passedSeat: null,
  };
}

export function flippedCells(
  board: readonly Stone[],
  move: ReversiMove,
  seat: number,
): number[] {
  if (
    (seat !== 0 && seat !== 1) ||
    !inBounds(move.row, move.col) ||
    board[cellIndex(move.row, move.col)] !== null
  )
    return [];
  const flipped: number[] = [];
  for (const [dr, dc] of DIRECTIONS) {
    const run: number[] = [];
    let row = move.row + dr;
    let col = move.col + dc;
    while (inBounds(row, col) && board[cellIndex(row, col)] === 1 - seat) {
      run.push(cellIndex(row, col));
      row += dr;
      col += dc;
    }
    if (run.length && inBounds(row, col) && board[cellIndex(row, col)] === seat)
      flipped.push(...run);
  }
  return flipped;
}

export function movesForSeat(
  board: readonly Stone[],
  seat: number,
): ReversiMove[] {
  const moves: ReversiMove[] = [];
  for (let index = 0; index < 64; index++) {
    if (board[index] !== null) continue;
    const move = { row: Math.floor(index / 8), col: index % 8 };
    if (flippedCells(board, move, seat).length) moves.push(move);
  }
  return moves;
}

export function legalMoves(state: ReversiState): ReversiMove[] {
  return state.finished ? [] : movesForSeat(state.board, state.turnSeat);
}

export function countStones(board: readonly Stone[]) {
  return {
    black: board.filter((cell) => cell === 0).length,
    white: board.filter((cell) => cell === 1).length,
  };
}

export function applyReversiMove(
  state: ReversiState,
  move: ReversiMove,
  seat = state.turnSeat,
): MoveResolution<ReversiState, ReversiPresentation> {
  if (state.finished || seat !== state.turnSeat)
    throw new Error("reversi: inactive seat");
  const flipped = flippedCells(state.board, move, seat);
  if (!flipped.length) throw new Error("reversi: illegal placement");
  const board = [...state.board];
  board[cellIndex(move.row, move.col)] = seat as Stone;
  for (const index of flipped) board[index] = seat as Stone;
  const opponentCanPlay = movesForSeat(board, 1 - seat).length > 0;
  const actorCanPlay = !opponentCanPlay && movesForSeat(board, seat).length > 0;
  const finished = !opponentCanPlay && !actorCanPlay;
  const { black, white } = countStones(board);
  return {
    state: {
      board,
      turnSeat: opponentCanPlay ? 1 - seat : seat,
      winnerSeat: finished && black !== white ? (black > white ? 0 : 1) : null,
      finished,
      moveCount: state.moveCount + 1,
      lastMove: { row: move.row, col: move.col, seat },
      passedSeat: actorCanPlay ? 1 - seat : null,
    },
    presentation: { row: move.row, col: move.col, flipped },
  };
}

export const reversiGame: GameDefinition<
  ReversiState,
  ReversiMove,
  ReversiPresentation
> = {
  id: "reversi",
  seatCount: 2,
  currentSeat: (state) => (state.finished ? null : state.turnSeat),
  winnerSeat: (state) => state.winnerSeat,
  isFinished: (state) => state.finished,
  applyMove: applyReversiMove,
};
