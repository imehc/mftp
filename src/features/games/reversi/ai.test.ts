import { describe, expect, it } from "vitest";

import { reversiAiStrategy } from "./ai";
import { createInitialReversiState, legalMoves } from "./rules";
import type { Stone } from "./types";

describe("黑白棋电脑策略", () => {
  it.each(["easy", "medium", "hard"] as const)(
    "%s 难度始终返回合法落点",
    async (difficulty) => {
      const state = createInitialReversiState();
      const move = await reversiAiStrategy.chooseMove(
        state,
        0,
        difficulty,
        new AbortController().signal,
      );
      expect(legalMoves(state)).toContainEqual(move);
    },
  );

  it("简单策略的随机性可复现", async () => {
    const choose = () =>
      reversiAiStrategy.chooseMove(
        createInitialReversiState(),
        0,
        "easy",
        new AbortController().signal,
      );
    expect(await choose()).toEqual(await choose());
  });

  it("优先取得可占领的角位，并正确搜索连续回合的残局", async () => {
    const board = Array<Stone>(64).fill(0);
    board[0] = board[7] = null;
    board[1] = board[6] = 1;
    const state = { ...createInitialReversiState(), board, moveCount: 58 };
    const move = await reversiAiStrategy.chooseMove(
      state,
      0,
      "hard",
      new AbortController().signal,
    );
    expect([
      { row: 0, col: 0 },
      { row: 0, col: 7 },
    ]).toContainEqual(move);
  });

  it("预先取消和计算中取消都不会产生旧走法", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      reversiAiStrategy.chooseMove(
        createInitialReversiState(),
        0,
        "hard",
        controller.signal,
      ),
    ).rejects.toThrow();
    const running = new AbortController();
    const promise = reversiAiStrategy.chooseMove(
      createInitialReversiState(),
      0,
      "hard",
      running.signal,
    );
    setTimeout(() => running.abort(), 1);
    await expect(promise).rejects.toThrow();
  });
});
