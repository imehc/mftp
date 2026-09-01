import {
  createRng,
  yieldToUi,
  type AiStrategy,
  type Difficulty,
} from "../engine/ai";
import type { SeatIndex } from "../engine/types";
import {
  BOARD_SIZE,
  WIN_LENGTH,
  type GomokuMove,
  type GomokuState,
} from "./types";
import { cellIndex, findWinningLine, inBounds, legalMoves } from "./rules";

const DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

const PROFILE: Record<
  Difficulty,
  { radius: number; noise: number; blunder: number }
> = {
  easy: { radius: 1, noise: 6, blunder: 0.24 },
  medium: { radius: 2, noise: 2.4, blunder: 0.05 },
  hard: { radius: 2, noise: 0.5, blunder: 0 },
};

function stateSeed(state: GomokuState, seat: SeatIndex): number {
  let h = (state.moveCount + 1) * 131 + seat;
  state.board.forEach((stone, index) => {
    if (stone !== null) h = Math.imul(h ^ (index + 17), 33) + stone + 1;
  });
  return h >>> 0;
}

function hasNeighbor(
  state: GomokuState,
  move: GomokuMove,
  radius: number,
): boolean {
  if (state.moveCount === 0) return true;
  for (let row = move.row - radius; row <= move.row + radius; row++) {
    for (let col = move.col - radius; col <= move.col + radius; col++) {
      if (!inBounds(row, col) || (row === move.row && col === move.col))
        continue;
      if (state.board[cellIndex(row, col)] !== null) return true;
    }
  }
  return false;
}

function runScore(
  state: GomokuState,
  move: GomokuMove,
  seat: SeatIndex,
  dr: number,
  dc: number,
): number {
  let stones = 1;
  let openEnds = 0;
  for (const sign of [-1, 1]) {
    for (let step = 1; step < WIN_LENGTH; step++) {
      const row = move.row + dr * step * sign;
      const col = move.col + dc * step * sign;
      if (!inBounds(row, col)) break;
      const stone = state.board[cellIndex(row, col)];
      if (stone === seat) {
        stones++;
        continue;
      }
      if (stone === null) openEnds++;
      break;
    }
  }
  if (stones >= WIN_LENGTH) return 100_000;
  if (stones === 4 && openEnds > 0) return 9_000;
  if (stones === 3 && openEnds === 2) return 1_200;
  if (stones === 3 && openEnds === 1) return 260;
  if (stones === 2 && openEnds === 2) return 90;
  return stones * stones + openEnds;
}

function scoreMove(
  state: GomokuState,
  move: GomokuMove,
  seat: SeatIndex,
): number {
  const opponent = 1 - seat;
  const winBoard = [...state.board];
  winBoard[cellIndex(move.row, move.col)] = seat;
  if (findWinningLine(winBoard, move, seat).length > 0) return 1_000_000;

  const blockBoard = [...state.board];
  blockBoard[cellIndex(move.row, move.col)] = opponent;
  if (findWinningLine(blockBoard, move, opponent).length > 0) return 800_000;

  let attack = 0;
  let defense = 0;
  for (const [dr, dc] of DIRECTIONS) {
    attack += runScore(state, move, seat, dr, dc);
    defense += runScore(state, move, opponent, dr, dc);
  }
  const center = (BOARD_SIZE - 1) / 2;
  const centerScore = 12 - Math.hypot(move.row - center, move.col - center);
  return attack * 1.15 + defense + centerScore;
}

export const gomokuAiStrategy: AiStrategy<GomokuState, GomokuMove> = {
  async chooseMove(state, seat, difficulty, signal) {
    const profile = PROFILE[difficulty];
    const rng = createRng(stateSeed(state, seat));
    const all = legalMoves(state);
    const candidates = all.filter((move) =>
      hasNeighbor(state, move, profile.radius),
    );
    const pool = candidates.length > 0 ? candidates : all;
    if (rng() < profile.blunder) return pool[Math.floor(rng() * pool.length)];

    let best = pool[0];
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      if (signal.aborted)
        throw signal.reason ?? new DOMException("Aborted", "AbortError");
      if (i % 60 === 0) await yieldToUi();
      const move = pool[i];
      const score =
        scoreMove(state, move, seat) + (rng() - 0.5) * profile.noise;
      if (score > bestScore) {
        best = move;
        bestScore = score;
      }
    }
    return best;
  },
};
