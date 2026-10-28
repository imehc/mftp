import { describe, expect, it } from "vitest";

import {
  canMove,
  createSolved,
  focusNeighbor,
  isSolvable,
  isSolved,
  moveTile,
  scrambleBoard,
} from "./engine";
import { PUZZLE_SIZES } from "./types";

describe("数字华容道规则", () => {
  for (const size of PUZZLE_SIZES) {
    it(`${size} 阶完成盘面和逆移动正确`, () => {
      const solved = createSolved(size);
      expect(isSolved(solved)).toBe(true);
      expect(isSolvable(solved)).toBe(true);
      const moved = moveTile(solved, size * size - 1);
      expect(isSolved(moved)).toBe(false);
      expect(isSolvable(moved)).toBe(true);
      expect(moveTile(moved, size * size - 1)).toEqual(solved);
    });

    it(`${size} 阶打乱均有解且未完成`, () => {
      let seed = 471;
      const random = () =>
        ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      for (let i = 0; i < 200; i++) {
        const board = scrambleBoard(size, random);
        expect(isSolvable(board)).toBe(true);
        expect(isSolved(board)).toBe(false);
        expect([...board.tiles].sort((a, b) => a - b)).toEqual(
          Array.from({ length: size * size }, (_, j) => j),
        );
      }
      expect(isSolved(scrambleBoard(size, () => 0.999999))).toBe(false);
    });

    it(`${size} 阶拒绝不可解、重复及越界数字`, () => {
      const board = createSolved(size);
      [board.tiles[0], board.tiles[1]] = [board.tiles[1], board.tiles[0]];
      expect(isSolvable(board)).toBe(false);
      board.tiles[0] = board.tiles[1];
      expect(isSolvable(board)).toBe(false);
      board.tiles[0] = -1;
      expect(isSolvable(board)).toBe(false);
    });
  }

  it("只允许空位相邻移动，拒绝斜向和跨行", () => {
    const board = { size: 3 as const, tiles: [1, 2, 0, 3, 4, 5, 6, 7, 8] };
    expect(canMove(board, 2)).toBe(true);
    expect(canMove(board, 5)).toBe(true);
    for (const tile of [0, 1, 3, 4, 8, 99, -1, NaN]) {
      expect(canMove(board, tile)).toBe(false);
      expect(moveTile(board, tile)).toBe(board);
    }
  });

  it("偶数棋盘空位改变行号时保持可解性", () => {
    const board = moveTile(createSolved(4), 12);
    expect(isSolvable(board)).toBe(true);
    [board.tiles[0], board.tiles[1]] = [board.tiles[1], board.tiles[0]];
    expect(isSolvable(board)).toBe(false);
  });

  it("方向键焦点不跨越棋盘边界", () => {
    expect(focusNeighbor(3, 4, "ArrowRight")).toBe(3);
    expect(focusNeighbor(4, 4, "ArrowLeft")).toBe(4);
    expect(focusNeighbor(0, 4, "ArrowUp")).toBe(0);
    expect(focusNeighbor(15, 4, "ArrowDown")).toBe(15);
    expect(focusNeighbor(5, 4, "ArrowDown")).toBe(9);
  });
});
