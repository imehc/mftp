import { describe, expect, it } from "vitest";

import { DIFFICULTIES } from "../engine/ai";
import { junqiAi } from "./ai";
import { validDeployment } from "./deployment";
import { applyAction, createInitialState, positionKey } from "./rules";

function playing() {
  const ready = applyAction(createInitialState(), { type: "ready" }, 0);
  return applyAction(ready, { type: "ready" }, 1);
}

describe("军棋电脑策略", () => {
  it("电脑依次生成合法阵型并确认，不修改对手阵型", async () => {
    let state = createInitialState();
    const opponent = structuredClone(state.board.slice(0, 30));
    const signal = new AbortController().signal;
    const arrange = await junqiAi.chooseMove(state, 0, "medium", signal);
    expect(arrange.type).toBe("arrange");
    state = applyAction(state, arrange, 0);
    expect(validDeployment(state.board, 0)).toBe(true);
    expect(state.board.slice(0, 30)).toEqual(opponent);
    const ready = await junqiAi.chooseMove(state, 0, "medium", signal);
    expect(ready).toEqual({ type: "ready" });
    expect(applyAction(state, ready, 0).ready).toEqual([true, false]);
  });

  it.each(DIFFICULTIES)(
    "%s 难度优先执行可以立即获胜的夺旗",
    async (difficulty) => {
      const state = playing();
      state.board = Array(60).fill(null);
      state.board[6] = { id: "attacker", side: 0, kind: "engineer" };
      state.board[1] = { id: "enemy-flag", side: 1, kind: "flag" };
      state.board[56] = { id: "own-flag", side: 0, kind: "flag" };
      state.board[25] = { id: "enemy", side: 1, kind: "commander" };
      state.positions = { [positionKey(state)]: 1 };
      const move = await junqiAi.chooseMove(
        state,
        0,
        difficulty,
        new AbortController().signal,
      );
      expect(move).toEqual({ type: "move", from: 6, to: 1 });
      expect(applyAction(state, move, 0).reason).toBe("flag");
    },
  );
});
