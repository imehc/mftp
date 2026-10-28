import { describe, expect, it } from "vitest";

import { createRng } from "../engine/ai";
import {
  applyReversiMove,
  countStones,
  createInitialReversiState,
  flippedCells,
  legalMoves,
  movesForSeat,
} from "./rules";
import type { ReversiState, Stone } from "./types";
import { undoPliesFor } from "./undo";

function position(board: Stone[]): ReversiState {
  return {
    ...createInitialReversiState(),
    board,
    moveCount: board.filter((cell) => cell !== null).length - 4,
  };
}

describe("黑白棋规则", () => {
  it("标准初始四子、黑方先行及四个合法落点", () => {
    const state = createInitialReversiState();
    expect(state.board[27]).toBe(1);
    expect(state.board[36]).toBe(1);
    expect(state.board[28]).toBe(0);
    expect(state.board[35]).toBe(0);
    expect(legalMoves(state)).toEqual([
      { row: 2, col: 3 },
      { row: 3, col: 2 },
      { row: 4, col: 5 },
      { row: 5, col: 4 },
    ]);
    const result = applyReversiMove(state, { row: 2, col: 3 });
    expect(result.presentation.flipped).toEqual([27]);
    expect(countStones(result.state.board)).toEqual({ black: 4, white: 1 });
    expect(state.board[27]).toBe(1);
  });

  it("同时翻转全部八个方向且不产生连锁夹击", () => {
    const board = Array<Stone>(64).fill(null);
    const expected: number[] = [];
    for (const dr of [-1, 0, 1])
      for (const dc of [-1, 0, 1]) {
        if (!dr && !dc) continue;
        board[(3 + dr) * 8 + 3 + dc] = 1;
        expected.push((3 + dr) * 8 + 3 + dc);
        board[(3 + 2 * dr) * 8 + 3 + 2 * dc] = 0;
      }
    expect(flippedCells(board, { row: 3, col: 3 }, 0).sort()).toEqual(
      expected.sort(),
    );
    expect(
      countStones(
        applyReversiMove(position(board), { row: 3, col: 3 }).state.board,
      ),
    ).toEqual({ black: 17, white: 0 });
  });

  it("边缘不绕行，不能跨空格或在无夹击处落子", () => {
    const board = Array<Stone>(64).fill(null);
    board[8] = 1;
    board[9] = 0;
    expect(flippedCells(board, { row: 0, col: 7 }, 0)).toEqual([]);
    board[1] = 1;
    board[3] = 0;
    expect(flippedCells(board, { row: 0, col: 0 }, 0)).toEqual([]);
    const initial = createInitialReversiState();
    for (const move of [
      { row: 0, col: 0 },
      { row: 3, col: 3 },
      { row: -1, col: 3 },
      { row: 2.5, col: 3 },
      { row: NaN, col: 3 },
    ])
      expect(() => applyReversiMove(initial, move)).toThrow();
    expect(() => applyReversiMove(initial, { row: 2, col: 3 }, 1)).toThrow();
  });

  it("对方无合法落点时自动跳过，己方连续落子并完整悔棋", () => {
    const board = Array<Stone>(64).fill(0);
    board[0] = board[7] = null;
    board[1] = board[6] = 1;
    const initial = position(board);
    const first = applyReversiMove(initial, { row: 0, col: 0 }).state;
    expect(first.passedSeat).toBe(1);
    expect(first.turnSeat).toBe(0);
    expect(first.finished).toBe(false);
    expect(undoPliesFor([initial, first], 0)).toBe(1);
    expect(undoPliesFor([initial, first], 1)).toBe(0);
    expect(applyReversiMove(first, { row: 0, col: 7 }).state.finished).toBe(
      true,
    );
  });

  it("双方都无处落子即结束，空格不影响终局判定", () => {
    const board = Array<Stone>(64).fill(0);
    board[0] = board[63] = null;
    board[1] = 1;
    const state = applyReversiMove(position(board), { row: 0, col: 0 }).state;
    expect(state.finished).toBe(true);
    expect(state.board[63]).toBe(null);
    expect(state.winnerSeat).toBe(0);
    expect(legalMoves(state)).toEqual([]);
  });

  it("终局按棋子数判断平局", () => {
    const board = Array<Stone>(64).fill(0);
    board[0] = null;
    board[1] = 1;
    for (let index = 32; index < 64; index++) board[index] = 1;
    const state = applyReversiMove(position(board), { row: 0, col: 0 }).state;
    expect(countStones(state.board)).toEqual({ black: 32, white: 32 });
    expect(state.finished).toBe(true);
    expect(state.winnerSeat).toBe(null);
  });

  it("随机完整对局始终保持棋子总数、合法回合和最多六十手", () => {
    let passes = 0;
    for (let seed = 0; seed < 50; seed++) {
      const rng = createRng(seed);
      let state = createInitialReversiState();
      while (!state.finished) {
        const moves = legalMoves(state);
        expect(moves.length).toBeGreaterThan(0);
        const next = applyReversiMove(
          state,
          moves[Math.floor(rng() * moves.length)],
        ).state;
        expect(next.board.filter((cell) => cell !== null).length).toBe(
          next.moveCount + 4,
        );
        expect(next.moveCount).toBeLessThanOrEqual(60);
        if (next.passedSeat !== null) {
          passes++;
          expect(movesForSeat(next.board, next.passedSeat)).toEqual([]);
          expect(next.turnSeat).toBe(state.turnSeat);
        }
        state = next;
      }
    }
    expect(passes).toBeGreaterThan(0);
  });
});
