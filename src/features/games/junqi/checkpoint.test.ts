import { describe, expect, it } from "vitest";

import { createRng } from "../engine/ai";
import { junqiAi } from "./ai";
import { junqiCheckpointSchema } from "./checkpoint";
import { legalMoves } from "./movement";
import { applyAction, createInitialState } from "./rules";

describe("军棋存档与电脑", () => {
  it("布阵和中盘历史可恢复，拒绝合法形状的篡改数据", () => {
    const history = [createInitialState()];
    for (const action of [
      { type: "arrange", seed: 51 },
      { type: "ready" },
      { type: "ready" },
    ] as const) {
      const current = history[history.length - 1];
      history.push(applyAction(current, action, current.turnSeat));
    }
    const current = history[history.length - 1];
    history.push(applyAction(current, legalMoves(current.board, 0)[0], 0));
    const checkpoint = {
      version: 1,
      gameId: "junqi",
      id: crypto.randomUUID(),
      savedAt: Date.now(),
      mode: { kind: "ai", difficulty: "medium", localSeat: 0, variant: "open" },
      history,
    };
    expect(junqiCheckpointSchema.safeParse(checkpoint).success).toBe(true);
    const corrupt = structuredClone(checkpoint);
    corrupt.history[1].board[0] = null;
    expect(junqiCheckpointSchema.safeParse(corrupt).success).toBe(false);
    checkpoint.history[3].quiet = 1;
    expect(junqiCheckpointSchema.safeParse(checkpoint).success).toBe(false);
  });

  it("电脑优先夺旗且遵循取消，输出走法合法", async () => {
    let state = createInitialState();
    state = applyAction(
      applyAction(state, { type: "ready" }, 0),
      { type: "ready" },
      1,
    );
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      const move = await junqiAi.chooseMove(
        state,
        0,
        difficulty,
        new AbortController().signal,
      );
      expect(legalMoves(state.board, 0)).toContainEqual(move);
    }
    state.board = Array(60).fill(null);
    state.board[6] = { id: "e", kind: "engineer", side: 0 };
    state.board[1] = { id: "f", kind: "flag", side: 1 };
    const move = await junqiAi.chooseMove(
      state,
      0,
      "hard",
      new AbortController().signal,
    );
    expect(move).toEqual({ type: "move", from: 6, to: 1 });
    const controller = new AbortController();
    controller.abort();
    await expect(
      junqiAi.chooseMove(state, 0, "hard", controller.signal),
    ).rejects.toThrow();
  });

  it("从布阵到自然终局的完整对局可重放，终局结果不能被篡改", () => {
    const history = [createInitialState()];
    const random = createRng(2710);
    let state = history[0];
    for (let step = 0; step < 5000 && state.phase !== "finished"; step++) {
      const moves = legalMoves(state.board, state.turnSeat);
      const action =
        state.phase === "deployment"
          ? ({ type: "ready" } as const)
          : moves[Math.floor(random() * moves.length)];
      state = applyAction(state, action, state.turnSeat);
      history.push(state);
    }
    expect(state.phase).toBe("finished");
    expect(state.ply).toBeGreaterThan(0);
    const checkpoint = {
      version: 1,
      gameId: "junqi",
      id: crypto.randomUUID(),
      savedAt: Date.now(),
      mode: { kind: "ai", difficulty: "medium", localSeat: 0, variant: "open" },
      history,
    };
    expect(junqiCheckpointSchema.safeParse(checkpoint).success).toBe(true);
    const corrupt = structuredClone(checkpoint);
    corrupt.history[corrupt.history.length - 1].winner =
      state.winner === 0 ? 1 : 0;
    expect(junqiCheckpointSchema.safeParse(corrupt).success).toBe(false);
  });
});
