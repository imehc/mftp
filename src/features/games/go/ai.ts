import { createRng, yieldToUi, type AiStrategy, type Difficulty } from "../engine/ai";
import type { SeatIndex } from "../engine/types";
import {
  cellIndex,
  computeTerritoryOwners,
  legalPlays,
  resolvePlacement,
} from "./rules";
import type { BoardSize, GoMove, GoState } from "./types";

const PROFILE: Record<Difficulty, { noise: number; blunder: number; top: number }> = {
  easy: { noise: 30, blunder: 0.18, top: 6 },
  medium: { noise: 9, blunder: 0.03, top: 3 },
  hard: { noise: 1.5, blunder: 0, top: 1 },
};

function stateSeed(state: GoState, seat: SeatIndex): number {
  let h = (state.moveCount + 1) * 131 + seat;
  state.board.forEach((stone, index) => {
    if (stone !== null) h = Math.imul(h ^ (index + 17), 33) + stone + 1;
  });
  return h >>> 0;
}

/** Opening star-point preference so the AI develops like a human. */
function starPoints(boardSize: BoardSize): number[] {
  const low = boardSize === 9 ? 2 : 3;
  const high = boardSize - 1 - low;
  const mid = (boardSize - 1) / 2;
  const lines = boardSize === 9 ? [low, mid, high] : [low, high];
  const points: number[] = [];
  for (const row of lines) {
    for (const col of lines) points.push(cellIndex(boardSize, row, col));
  }
  points.push(cellIndex(boardSize, mid, mid));
  return points;
}

function hasNeighbor(state: GoState, row: number, col: number, radius: number): boolean {
  const size = state.boardSize;
  for (let r = row - radius; r <= row + radius; r++) {
    for (let c = col - radius; c <= col + radius; c++) {
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      if (r === row && c === col) continue;
      if (state.board[cellIndex(size, r, c)] !== null) return true;
    }
  }
  return false;
}

function scoreCandidate(
  state: GoState,
  move: GoMove,
  seat: SeatIndex,
  territoryOwners: GoState["board"],
): number {
  if (move.kind === "pass") return -1000;
  const size = state.boardSize;
  const index = cellIndex(size, move.row, move.col);
  const placed = resolvePlacement(state.board, size, index, seat, state.koPoint);
  if (!placed) return -Infinity;

  const opponent = (1 - seat) as SeatIndex;
  let score = placed.captured.length * 55 + Math.min(placed.placedLiberties, 4) * 2;

  // Filling settled territory loses tempo. An invasion can still override
  // this penalty when it captures or creates a concrete attack.
  const territoryOwner = territoryOwners[index];
  if (territoryOwner === seat) score -= 18;
  else if (territoryOwner === opponent) score -= 12;
  else score += 4;

  // Saving stones: liberties our new stone shares with friendly chains.
  const friendlySeen = new Set<number>();
  for (const adjacent of neighborsOf(size, index)) {
    if (placed.board[adjacent] !== seat || friendlySeen.has(adjacent)) continue;
    const chain = chainLiberties(placed.board, size, adjacent);
    for (const stone of chain.stones) friendlySeen.add(stone);
    if (chain.liberties >= 3) score += 6;
  }

  // Attacking: does the move reduce an enemy chain to one liberty (atari)?
  const enemySeen = new Set<number>();
  for (const adjacent of neighborsOf(size, index)) {
    if (placed.board[adjacent] !== opponent || enemySeen.has(adjacent)) continue;
    const chain = chainLiberties(placed.board, size, adjacent);
    for (const stone of chain.stones) enemySeen.add(stone);
    if (chain.liberties === 1) score += 28;
  }

  if (state.moveCount < size) {
    // Opening: value star points and the third/fourth line, avoid edges.
    const stars = starPoints(size);
    if (stars.includes(index)) score += 18;
    const edgeDist = Math.min(move.row, move.col, size - 1 - move.row, size - 1 - move.col);
    if (edgeDist === 0) score -= 14;
    else if (edgeDist === 1) score -= 5;
  } else {
    // Midgame: stay near the action, prefer the center side of the board.
    const center = (size - 1) / 2;
    score += 4 - Math.hypot(move.row - center, move.col - center) / size;
  }
  return score;
}

function neighborsOf(size: number, index: number): number[] {
  const row = Math.floor(index / size);
  const col = index % size;
  const out: number[] = [];
  if (row > 0) out.push(index - size);
  if (row < size - 1) out.push(index + size);
  if (col > 0) out.push(index - 1);
  if (col < size - 1) out.push(index + 1);
  return out;
}

function chainLiberties(
  board: readonly (SeatIndex | null)[],
  size: number,
  index: number,
): { stones: number[]; liberties: number } {
  const seat = board[index];
  const stones: number[] = [];
  const seen = new Set<number>([index]);
  const stack = [index];
  const liberties = new Set<number>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    stones.push(current);
    for (const next of neighborsOf(size, current)) {
      const stone = board[next];
      if (stone === null) liberties.add(next);
      else if (stone === seat && !seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return { stones, liberties: liberties.size };
}

/** Pass after the opening when only low-value territory filling remains. */
function shouldPass(state: GoState, bestScore: number): boolean {
  return state.moveCount >= state.boardSize * 2 && bestScore < 6;
}

export const goAiStrategy: AiStrategy<GoState, GoMove> = {
  async chooseMove(state, seat, difficulty, signal) {
    const profile = PROFILE[difficulty];
    const rng = createRng(stateSeed(state, seat));
    const radius = state.moveCount < 6 ? state.boardSize : 2;
    const legal = legalPlays(state);
    if (legal.length === 0) return { kind: "pass" };
    const territoryOwners = computeTerritoryOwners(state.board, state.boardSize);
    const nearby = legal.filter(
      (move) => move.kind === "play" && hasNeighbor(state, move.row, move.col, radius),
    );
    // Sparse board (opening / lone reply): no neighboring stones means the
    // filter is empty, so fall back to every legal point. Passing is decided
    // only by shouldPass, never by an accident of the neighbor filter.
    const pool = nearby.length > 0 ? nearby : legal;

    const scored: Array<{ move: GoMove; score: number }> = [];
    for (let i = 0; i < pool.length; i++) {
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      if (i % 16 === 0) await yieldToUi();
      const move = pool[i];
      scored.push({
        move,
        score:
          scoreCandidate(state, move, seat, territoryOwners) +
          (rng() - 0.5) * profile.noise,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (shouldPass(state, best.score)) return { kind: "pass" };
    if (rng() < profile.blunder) {
      return pool[Math.floor(rng() * pool.length)];
    }
    const pick = Math.floor(rng() * Math.min(profile.top, scored.length));
    return scored[pick].move;
  },
};
