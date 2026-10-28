import { Chess, type Move, type PieceSymbol } from "chess.js";

import { createRng, type Difficulty } from "../engine/ai";
import {
  claimReason,
  halfMoves,
  positionKey,
  repetitions,
  turnFrom,
} from "./rules";
import type { ChessMove, ChessState } from "./types";

const VALUE: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 335,
  r: 500,
  q: 900,
  k: 0,
};
export const SEARCH_PROFILE = {
  easy: { ms: 180, nodes: 3000, depth: 2 },
  medium: { ms: 450, nodes: 10000, depth: 4 },
  hard: { ms: 1100, nodes: 35000, depth: 5 },
} as const;

function evaluate(chess: Chess): number {
  let score = 0;
  const board = chess.board();
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece) continue;
      const progress = piece.color === "w" ? 6 - row : row - 1;
      const centre = 7 - Math.abs(3.5 - row) - Math.abs(3.5 - col);
      const bonus =
        piece.type === "p"
          ? progress * 9 + centre * 3
          : piece.type === "n" || piece.type === "b"
            ? centre * 12
            : piece.type === "k"
              ? -centre * 3
              : centre * 2;
      score += (piece.color === "w" ? 1 : -1) * (VALUE[piece.type] + bonus);
    }
  return score * (chess.turn() === "w" ? 1 : -1);
}

function ordered(moves: Move[]): Move[] {
  const priority = (move: Move) =>
    (move.captured ? 10 * VALUE[move.captured] - VALUE[move.piece] : 0) +
    (move.promotion ? VALUE[move.promotion] : 0) +
    (move.san.includes("+") ? 35 : 0);
  return moves.sort((a, b) => priority(b) - priority(a));
}

/** Worker 内搜索；只提交完整迭代的结果，预算耗尽仍返回已验证的合法着法。 */
export function searchChess(
  state: ChessState,
  difficulty: Difficulty,
): ChessMove {
  if (state.result) throw new Error("Cannot search a finished chess game");
  if (claimReason(state)) return { type: "claim" };
  const chess = new Chess(state.fen),
    profile = SEARCH_PROFILE[difficulty];
  const deadline = performance.now() + profile.ms;
  const root = ordered(chess.moves({ verbose: true }));
  if (!root.length) throw new Error("Chess AI has no legal move");
  let best = root[0],
    nodes = 0;
  const exhausted = Symbol("budget");
  const positions = [...state.positions];

  function visit(
    depth: number,
    alpha: number,
    beta: number,
    ply: number,
    quiet = 3,
  ): number {
    nodes++;
    if (nodes >= profile.nodes || performance.now() >= deadline)
      throw exhausted;
    const inCheck = chess.isCheck();
    const moves = chess.moves({ verbose: true });
    if (!moves.length) return inCheck ? -100000 + ply : 0;
    if (
      chess.isInsufficientMaterial() ||
      halfMoves(chess) >= 150 ||
      repetitions(positions, positionKey(chess)) >= 5
    )
      return 0;
    // 可申领和棋是一个零分候选，不把赢棋局面强制截断为和棋。
    const claimable =
      halfMoves(chess) >= 100 ||
      repetitions(positions, positionKey(chess)) >= 3;
    let score = claimable ? 0 : -Infinity;
    if (depth <= 0 && !inCheck) {
      const stand = evaluate(chess);
      if (quiet <= 0 || stand >= beta) return Math.max(score, stand);
      alpha = Math.max(alpha, stand);
      score = Math.max(score, stand);
    }
    if (ply >= 12) return Math.max(score, evaluate(chess));
    const candidates =
      depth <= 0 && !inCheck
        ? moves.filter((move) => move.captured || move.promotion)
        : moves;
    for (const move of ordered(candidates)) {
      chess.move(move);
      positions.push(positionKey(chess));
      let value: number;
      try {
        value = -visit(
          depth - 1,
          -beta,
          -alpha,
          ply + 1,
          depth <= 0 ? quiet - 1 : quiet,
        );
      } finally {
        positions.pop();
        chess.undo();
      }
      score = Math.max(score, value);
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return score;
  }

  for (let depth = 1; depth <= profile.depth; depth++) {
    const scored: Array<{ move: Move; score: number }> = [];
    try {
      for (const move of root) {
        chess.move(move);
        positions.push(positionKey(chess));
        let score: number;
        try {
          score = -visit(depth - 1, -Infinity, Infinity, 1);
        } finally {
          positions.pop();
          chess.undo();
        }
        scored.push({ move, score });
      }
    } catch (error) {
      if (error !== exhausted) throw error;
      break;
    }
    scored.sort((a, b) => b.score - a.score);
    best = scored[0].move;
    if (scored[0].score >= 99990) break;
    if (difficulty === "easy") {
      const rng = createRng(
        state.ply * 7919 + parseInt(chess.hash().slice(-7), 16),
      );
      const near = scored
        .filter((item) => item.score >= scored[0].score - 100)
        .slice(0, 3);
      best = near[Math.floor(rng() * near.length)].move;
    }
    root.sort((a, b) => Number(b === best) - Number(a === best));
  }
  return { type: "move", ...turnFrom(best) };
}
