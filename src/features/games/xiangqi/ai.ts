import {
  createRng,
  yieldToUi,
  type AiStrategy,
  type Difficulty,
} from "../engine/ai";
import type { SeatIndex } from "../engine/types";
import {
  applyMoveToBoard,
  boardCoordinate,
  isInCheck,
  legalMoves,
  legalMovesForSeat,
} from "./rules";
import type {
  PieceKind,
  XiangqiMove,
  XiangqiPiece,
  XiangqiState,
} from "./types";

const PIECE_VALUE: Record<PieceKind, number> = {
  general: 100_000,
  rook: 900,
  cannon: 450,
  horse: 400,
  elephant: 220,
  advisor: 220,
  soldier: 100,
};

const PROFILE: Record<
  Difficulty,
  { depth: number; branch: number; noise: number; top: number; blunder: number }
> = {
  easy: { depth: 1, branch: 28, noise: 130, top: 5, blunder: 0.18 },
  medium: { depth: 2, branch: 22, noise: 22, top: 2, blunder: 0.03 },
  hard: { depth: 3, branch: 16, noise: 2, top: 1, blunder: 0 },
};

function stateSeed(state: XiangqiState, seat: SeatIndex): number {
  let hash = (state.moveCount + 1) * 131 + seat;
  state.board.forEach((piece, index) => {
    if (!piece) return;
    hash =
      Math.imul(hash ^ (index + 17), 33) + piece.side * 7 + piece.kind.length;
  });
  return hash >>> 0;
}

function pieceScore(piece: XiangqiPiece, index: number): number {
  const { row, col } = boardCoordinate(index);
  let score = PIECE_VALUE[piece.kind];
  if (piece.kind === "soldier") {
    const progress = piece.side === 0 ? 6 - row : row - 3;
    score += Math.max(0, progress) * 22;
    if (col >= 2 && col <= 6) score += 8;
  } else if (piece.kind === "horse" || piece.kind === "cannon") {
    score += 12 - Math.abs(4 - col) * 2;
  }
  return score;
}

function evaluate(
  board: readonly (XiangqiPiece | null)[],
  perspective: SeatIndex,
): number {
  let score = 0;
  board.forEach((piece, index) => {
    if (!piece) return;
    const value = pieceScore(piece, index);
    score += piece.side === perspective ? value : -value;
  });
  if (isInCheck(board, 1 - perspective)) score += 55;
  if (isInCheck(board, perspective)) score -= 70;
  return score;
}

function movePriority(
  board: readonly (XiangqiPiece | null)[],
  move: XiangqiMove,
): number {
  const captured = board[move.to];
  const moving = board[move.from];
  const captureScore = captured ? PIECE_VALUE[captured.kind] * 10 : 0;
  const risk = moving ? PIECE_VALUE[moving.kind] : 0;
  const { col } = boardCoordinate(move.to);
  return captureScore - risk * 0.05 - Math.abs(4 - col);
}

function orderedMoves(
  board: readonly (XiangqiPiece | null)[],
  moves: XiangqiMove[],
  limit: number,
): XiangqiMove[] {
  return moves
    .map((move) => ({ move, score: movePriority(board, move) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.move);
}

function minimax(
  board: readonly (XiangqiPiece | null)[],
  turnSeat: SeatIndex,
  perspective: SeatIndex,
  depth: number,
  branch: number,
  alpha: number,
  beta: number,
): number {
  const moves = legalMovesForSeat(board, turnSeat);
  if (moves.length === 0) {
    return turnSeat === perspective ? -900_000 - depth : 900_000 + depth;
  }
  if (depth === 0) return evaluate(board, perspective);

  const maximizing = turnSeat === perspective;
  let best = maximizing ? -Infinity : Infinity;
  for (const move of orderedMoves(board, moves, branch)) {
    const next = applyMoveToBoard(board, move);
    const score = minimax(
      next,
      1 - turnSeat,
      perspective,
      depth - 1,
      branch,
      alpha,
      beta,
    );
    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

export const xiangqiAiStrategy: AiStrategy<XiangqiState, XiangqiMove> = {
  async chooseMove(state, seat, difficulty, signal) {
    const profile = PROFILE[difficulty];
    const rng = createRng(stateSeed(state, seat));
    const moves = legalMoves(state);
    if (moves.length === 0) throw new Error("xiangqi AI has no legal move");
    const pool = orderedMoves(
      state.board,
      moves,
      Math.max(profile.branch, moves.length),
    );
    if (rng() < profile.blunder) return pool[Math.floor(rng() * pool.length)];

    const scored: Array<{ move: XiangqiMove; score: number }> = [];
    for (let index = 0; index < pool.length; index++) {
      if (signal.aborted)
        throw signal.reason ?? new DOMException("Aborted", "AbortError");
      if (index % 4 === 0) await yieldToUi();
      const move = pool[index];
      const board = applyMoveToBoard(state.board, move);
      const score =
        minimax(
          board,
          1 - seat,
          seat,
          profile.depth - 1,
          profile.branch,
          -Infinity,
          Infinity,
        ) +
        (rng() - 0.5) * profile.noise;
      scored.push({ move, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const pick = Math.floor(rng() * Math.min(profile.top, scored.length));
    return scored[pick].move;
  },
};
