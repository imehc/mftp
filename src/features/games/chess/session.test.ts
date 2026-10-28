import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";

import { LocalController } from "../engine/controllers";
import { MatchRunner } from "../engine/match";
import { parseChessMove } from "./checkpoint";
import { CHESS_ONLINE } from "./onlineProtocol";
import { applyChessMove, chessGame, createChessState } from "./rules";
import type { ChessMove, ChessState } from "./types";
import { chessUndoPlies } from "./undo";

const settle = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};

describe("国际象棋悔棋与同步", () => {
  it.each([
    [
      "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
      { type: "move", from: "e1", to: "g1" },
    ],
    [
      "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1",
      { type: "move", from: "e5", to: "d6" },
    ],
    [
      "7k/P7/8/8/8/8/8/7K w - - 0 1",
      { type: "move", from: "a7", to: "a8", promotion: "q" },
    ],
  ] as const)(
    "特殊走法在传输后保持相同状态，悔棋恢复全部规则权利：%s",
    async (fen, move) => {
      const initial = createChessState(fen);
      const local = new LocalController<ChessState, ChessMove>();
      const runner = new MatchRunner(chessGame, initial, [local, local]);
      runner.start();
      try {
        const received = parseChessMove(JSON.parse(JSON.stringify(move)));
        expect(received).not.toBeNull();
        local.submit(move);
        await settle();
        const remote = applyChessMove(initial, received!, 0).state;
        expect(CHESS_ONLINE.hash(runner.getSnapshot().state)).toBe(
          CHESS_ONLINE.hash(remote),
        );
        expect(chessUndoPlies(runner, runner.getSnapshot())).toBe(1);
        expect(runner.undo(1)).toBe(true);
        expect(runner.getSnapshot().state).toEqual(initial);
        expect(new Chess(runner.getSnapshot().state.fen).fen()).toBe(
          initial.fen,
        );
      } finally {
        runner.dispose();
      }
    },
  );

  it("状态哈希覆盖重复历史与和棋申领，不能只比较棋盘", () => {
    const state = createChessState();
    expect(CHESS_ONLINE.hash(state)).not.toBe(
      CHESS_ONLINE.hash({
        ...state,
        positions: [...state.positions, ...state.positions],
      }),
    );
    expect(CHESS_ONLINE.hash(state)).not.toBe(
      CHESS_ONLINE.hash({
        ...state,
        result: "threefold",
        lastAction: { type: "claim" },
      }),
    );
  });

  it("双人撤回一手，人机和联机撤回至自己的上一手之前", async () => {
    const local = new LocalController<ChessState, ChessMove>();
    const runner = new MatchRunner(chessGame, createChessState(), [
      local,
      local,
    ]);
    runner.start();
    try {
      local.submit({ type: "move", from: "e2", to: "e4" });
      await settle();
      local.submit({ type: "move", from: "e7", to: "e5" });
      await settle();
      expect(chessUndoPlies(runner, runner.getSnapshot())).toBe(1);
      expect(chessUndoPlies(runner, runner.getSnapshot(), 0)).toBe(2);
      expect(chessUndoPlies(runner, runner.getSnapshot(), 1)).toBe(1);
    } finally {
      runner.dispose();
    }
  });
});
