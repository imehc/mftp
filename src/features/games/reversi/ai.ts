import { type AiStrategy, createRng, yieldToUi } from "../engine/ai";
import {
  applyReversiMove,
  cellIndex,
  countStones,
  legalMoves,
  movesForSeat,
} from "./rules";
import type { ReversiMove, ReversiState } from "./types";

const CORNERS = [0, 7, 56, 63];
const CORNER_NEIGHBORS = [
  [1, 8, 9],
  [6, 14, 15],
  [48, 49, 57],
  [54, 55, 62],
];

export function evaluatePosition(state: ReversiState, seat: number): number {
  const { black, white } = countStones(state.board);
  const difference = (black - white) * (seat === 0 ? 1 : -1);
  if (state.finished) return Math.sign(difference) * 100000 + difference;
  let score = difference * (state.moveCount > 44 ? 8 : 1);
  score +=
    12 *
    (movesForSeat(state.board, seat).length -
      movesForSeat(state.board, 1 - seat).length);
  state.board.forEach((stone, index) => {
    if (stone === null) return;
    const sign = stone === seat ? 1 : -1;
    const row = Math.floor(index / 8);
    const col = index % 8;
    if (CORNERS.includes(index)) score += sign * 240;
    else if (row === 0 || row === 7 || col === 0 || col === 7)
      score += sign * 12;
    // 暴露在空格旁的棋子容易被翻转，开中局不鼓励单纯追求子数。
    const frontier = [-1, 0, 1].some((dr) =>
      [-1, 0, 1].some(
        (dc) =>
          row + dr >= 0 &&
          row + dr < 8 &&
          col + dc >= 0 &&
          col + dc < 8 &&
          state.board[cellIndex(row + dr, col + dc)] === null,
      ),
    );
    if (frontier) score -= sign * 5;
  });
  CORNERS.forEach((corner, i) => {
    if (state.board[corner] !== null) return;
    for (const neighbor of CORNER_NEIGHBORS[i]) {
      const stone = state.board[neighbor];
      if (stone !== null) score -= (stone === seat ? 1 : -1) * 65;
    }
  });
  return score;
}

class SearchBudgetReached extends Error {}

export const reversiAiStrategy: AiStrategy<ReversiState, ReversiMove> = {
  async chooseMove(state, seat, difficulty, signal) {
    signal.throwIfAborted();
    if (seat !== state.turnSeat)
      throw new Error("reversi: AI seat is not active");
    const moves = legalMoves(state);
    if (!moves.length) throw new Error("reversi: no legal AI move");
    const rng = createRng(
      state.board.reduce<number>(
        (seed, stone) => Math.imul(seed, 31) + (stone ?? 2),
        state.moveCount,
      ),
    );
    const ordered = moves
      .map((move) => ({
        move,
        score:
          evaluatePosition(applyReversiMove(state, move).state, seat) +
          (difficulty === "easy" ? rng() * 90 : 0),
      }))
      .sort((a, b) => b.score - a.score);
    if (difficulty === "easy") return ordered[0].move;
    let best = ordered[0].move;
    let nodes = 0;
    let lastYield = performance.now();
    const deadline = lastYield + (difficulty === "hard" ? 650 : 180);
    const maxNodes = difficulty === "hard" ? 18000 : 3500;

    const search = async (
      position: ReversiState,
      depth: number,
      alpha: number,
      beta: number,
    ): Promise<number> => {
      signal.throwIfAborted();
      nodes++;
      const now = performance.now();
      if (nodes > maxNodes || now >= deadline) throw new SearchBudgetReached();
      if (now - lastYield >= 4) {
        await yieldToUi();
        signal.throwIfAborted();
        lastYield = performance.now();
      }
      if (position.finished || depth === 0)
        return evaluatePosition(position, seat);
      // 规则已经处理跳过回合，下一层可能仍由同一方行动。
      const maximizing = position.turnSeat === seat;
      let value = maximizing ? -Infinity : Infinity;
      const candidates = legalMoves(position).sort(
        (a, b) =>
          Number(CORNERS.includes(cellIndex(b.row, b.col))) -
          Number(CORNERS.includes(cellIndex(a.row, a.col))),
      );
      for (const move of candidates) {
        const result = await search(
          applyReversiMove(position, move).state,
          depth - 1,
          alpha,
          beta,
        );
        value = maximizing ? Math.max(value, result) : Math.min(value, result);
        if (maximizing) alpha = Math.max(alpha, value);
        else beta = Math.min(beta, value);
        if (beta <= alpha) break;
      }
      return value;
    };

    for (let depth = 1; depth <= (difficulty === "hard" ? 9 : 4); depth++) {
      let nextBest = best;
      let score = -Infinity;
      try {
        for (const candidate of ordered) {
          const value = await search(
            applyReversiMove(state, candidate.move).state,
            depth - 1,
            score,
            Infinity,
          );
          if (value > score) {
            score = value;
            nextBest = candidate.move;
          }
        }
        best = nextBest;
      } catch (error) {
        if (!(error instanceof SearchBudgetReached)) throw error;
        break;
      }
    }
    signal.throwIfAborted();
    return best;
  },
};
