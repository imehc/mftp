import type {
  GameDefinition,
  MoveResolution,
  SeatIndex,
} from "../engine/types";
import {
  KOMI,
  type BoardSize,
  type GoMove,
  type GoPresentation,
  type GoState,
  type Stone,
} from "./types";

export function cellIndex(boardSize: number, row: number, col: number): number {
  return row * boardSize + col;
}

export function inBounds(boardSize: number, row: number, col: number): boolean {
  return row >= 0 && row < boardSize && col >= 0 && col < boardSize;
}

export function boardPositionKey(board: readonly Stone[]): string {
  return board.map((stone) => (stone === null ? "." : String(stone))).join("");
}

export function createInitialGoState(boardSize: BoardSize): GoState {
  const board = Array<Stone>(boardSize * boardSize).fill(null);
  return {
    boardSize,
    board,
    turnSeat: 0,
    koPoint: null,
    captures: [0, 0],
    consecutivePasses: 0,
    positionHistory: [boardPositionKey(board)],
    finished: false,
    winnerSeat: null,
    finalScore: null,
    moveCount: 0,
    lastMove: null,
    lastCaptured: [],
  };
}

function neighbors(boardSize: number, index: number): number[] {
  const row = Math.floor(index / boardSize);
  const col = index % boardSize;
  const out: number[] = [];
  if (row > 0) out.push(index - boardSize);
  if (row < boardSize - 1) out.push(index + boardSize);
  if (col > 0) out.push(index - 1);
  if (col < boardSize - 1) out.push(index + 1);
  return out;
}

interface Group {
  stones: number[];
  liberties: number;
}

/** 洪泛填充包含 `index` 的棋链并统计其气。 */
function collectGroup(
  board: readonly Stone[],
  boardSize: number,
  index: number,
): Group {
  const seat = board[index];
  const stones: number[] = [];
  const seen = new Set<number>([index]);
  const stack = [index];
  let liberties = 0;
  const libertySeen = new Set<number>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    stones.push(current);
    for (const next of neighbors(boardSize, current)) {
      const stone = board[next];
      if (stone === null) {
        if (!libertySeen.has(next)) {
          libertySeen.add(next);
          liberties++;
        }
      } else if (stone === seat && !seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return { stones, liberties };
}

export interface PlacedResult {
  board: Stone[];
  captured: Array<{ index: number; seat: SeatIndex }>;
  /** 提子后所落棋子的棋链大小（劫需要用到）。 */
  placedGroupSize: number;
  placedLiberties: number;
}

/**
 * 落子并解决提子。以下情况返回 null：落子非法——已有子、自杀，或
 * 处于劫点。调用方负责检查越界。
 */
export function resolvePlacement(
  board: readonly Stone[],
  boardSize: number,
  index: number,
  seat: SeatIndex,
  koPoint: number | null,
): PlacedResult | null {
  if (board[index] !== null) return null;
  if (koPoint === index) return null;

  const next = [...board];
  next[index] = seat;
  const opponent = (1 - seat) as SeatIndex;

  const captured: Array<{ index: number; seat: SeatIndex }> = [];
  const checked = new Set<number>();
  for (const adjacent of neighbors(boardSize, index)) {
    if (next[adjacent] !== opponent || checked.has(adjacent)) continue;
    const group = collectGroup(next, boardSize, adjacent);
    for (const stone of group.stones) checked.add(stone);
    if (group.liberties === 0) {
      for (const stone of group.stones) {
        next[stone] = null;
        captured.push({ index: stone, seat: opponent });
      }
    }
  }

  const placed = collectGroup(next, boardSize, index);
  if (placed.liberties === 0) return null; // 自杀手
  return {
    board: next,
    captured,
    placedGroupSize: placed.stones.length,
    placedLiberties: placed.liberties,
  };
}

/**
 * 中国规则的目数（数子）计分：某方地域 = 盘上己方棋子 + 仅与该方
 * 相邻的空点。双方都相邻的点（单官）双方都不计。须在双方都停手后调用。
 */
export function computeAreaScore(
  board: readonly Stone[],
  boardSize: number,
): [number, number] {
  const score: [number, number] = [0, 0];
  const territoryOwners = computeTerritoryOwners(board, boardSize);
  board.forEach((stone, index) => {
    const owner = stone ?? territoryOwners[index];
    if (owner !== null) score[owner]++;
  });
  return score;
}

/** 仅被一方包围的空交叉点归该方；单官保持 null。 */
export function computeTerritoryOwners(
  board: readonly Stone[],
  boardSize: number,
): Stone[] {
  const owners = Array<Stone>(board.length).fill(null);
  const visited = new Set<number>();
  for (let start = 0; start < board.length; start++) {
    if (board[start] !== null || visited.has(start)) continue;
    const region: number[] = [];
    const borders = new Set<SeatIndex>();
    const stack = [start];
    visited.add(start);
    while (stack.length > 0) {
      const current = stack.pop()!;
      region.push(current);
      for (const next of neighbors(boardSize, current)) {
        const stone = board[next];
        if (stone === null) {
          if (!visited.has(next)) {
            visited.add(next);
            stack.push(next);
          }
        } else {
          borders.add(stone);
        }
      }
    }
    if (borders.size === 1) {
      const owner = [...borders][0];
      for (const index of region) owners[index] = owner;
    }
  }
  return owners;
}

export function isLegalPlay(state: GoState, row: number, col: number): boolean {
  if (state.finished || !inBounds(state.boardSize, row, col)) return false;
  const index = cellIndex(state.boardSize, row, col);
  const placed = resolvePlacement(
    state.board,
    state.boardSize,
    index,
    state.turnSeat,
    state.koPoint,
  );
  return (
    placed !== null &&
    !state.positionHistory.includes(boardPositionKey(placed.board))
  );
}

export function legalPlays(state: GoState): GoMove[] {
  if (state.finished) return [];
  const moves: GoMove[] = [];
  const previousPositions = new Set(state.positionHistory);
  for (let row = 0; row < state.boardSize; row++) {
    for (let col = 0; col < state.boardSize; col++) {
      const index = cellIndex(state.boardSize, row, col);
      const placed = resolvePlacement(
        state.board,
        state.boardSize,
        index,
        state.turnSeat,
        state.koPoint,
      );
      if (placed && !previousPositions.has(boardPositionKey(placed.board))) {
        moves.push({ kind: "play", row, col });
      }
    }
  }
  return moves;
}

export const goGame: GameDefinition<GoState, GoMove, GoPresentation> = {
  id: "go",
  seatCount: 2,
  currentSeat: (state) => (state.finished ? null : state.turnSeat),
  winnerSeat: (state) => state.winnerSeat,
  isFinished: (state) => state.finished,
  applyMove(state, move, seat): MoveResolution<GoState, GoPresentation> {
    if (state.finished) throw new Error("go: match already finished");
    if (seat !== state.turnSeat) throw new Error("go: wrong seat");

    if (move.kind === "pass") {
      const passes = state.consecutivePasses + 1;
      const finished = passes >= 2;
      const finalScore = finished
        ? computeAreaScore(state.board, state.boardSize)
        : null;
      return {
        state: {
          ...state,
          turnSeat: finished ? state.turnSeat : ((1 - seat) as SeatIndex),
          koPoint: null,
          consecutivePasses: passes,
          finished,
          winnerSeat: finished
            ? finalScore![0] > finalScore![1] + KOMI
              ? 0
              : 1
            : null,
          finalScore,
          moveCount: state.moveCount + 1,
          lastMove: move,
          lastCaptured: [],
        },
        presentation: { move, captured: [] },
      };
    }

    if (!inBounds(state.boardSize, move.row, move.col)) {
      throw new Error("go: move out of bounds");
    }
    const index = cellIndex(state.boardSize, move.row, move.col);
    const placed = resolvePlacement(
      state.board,
      state.boardSize,
      index,
      seat,
      state.koPoint,
    );
    if (!placed) throw new Error("go: illegal move");
    const positionKey = boardPositionKey(placed.board);
    if (state.positionHistory.includes(positionKey)) {
      throw new Error("go: repeated board position");
    }

    // 劫：当落子恰好提掉一子，并形成一个仅有一气的单子棋链时，
    // 对方不能立即回提。
    const koPoint =
      placed.captured.length === 1 &&
      placed.placedGroupSize === 1 &&
      placed.placedLiberties === 1
        ? placed.captured[0].index
        : null;

    const captures: [number, number] = [...state.captures];
    captures[seat] += placed.captured.length;
    return {
      state: {
        ...state,
        board: placed.board,
        turnSeat: (1 - seat) as SeatIndex,
        koPoint,
        captures,
        consecutivePasses: 0,
        positionHistory: [...state.positionHistory, positionKey],
        moveCount: state.moveCount + 1,
        lastMove: move,
        lastCaptured: placed.captured,
      },
      presentation: { move, captured: placed.captured },
    };
  },
};
