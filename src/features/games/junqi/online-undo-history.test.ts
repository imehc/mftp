import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";

import { JunqiUndoHistory, UNDO_HISTORY_LIMIT } from "./online-undo";
import { applyAction, createInitialState, positionKey } from "./rules";
import { projectView } from "./visibility";

beforeAll(() => {
  i18n.load("zh-CN", {});
  i18n.activate("zh-CN");
});

describe("军棋裁判私有回退历史", () => {
  it("司令交战亮旗后恢复棋子、隐藏候选、计数和最后动作", () => {
    let initial = createInitialState("hidden", 91);
    initial = applyAction(initial, { type: "ready" }, 0);
    initial = applyAction(initial, { type: "ready" }, 1);
    if (initial.variant !== "hidden") throw new Error("Invalid fixture");
    initial.board = Array(60).fill(null);
    initial.board[30] = { id: "a", side: 0, kind: "bomb" };
    initial.board[25] = { id: "b", side: 1, kind: "commander" };
    initial.board[1] = { id: "flag", side: 1, kind: "flag" };
    initial.board[20] = { id: "other", side: 1, kind: "engineer" };
    initial.board[35] = { id: "ours", side: 0, kind: "platoon" };
    initial.board[56] = { id: "own-flag", side: 0, kind: "flag" };
    initial.positions = { [positionKey(initial)]: 2 };
    initial.quiet = 98;
    initial.knowledge = [
      { b: ["commander", "general", "bomb"], flag: ["flag", "mine"] },
      {},
    ];
    const original = structuredClone(initial);
    const next = applyAction(initial, { type: "move", from: 30, to: 25 }, 0);
    expect(next.phase).toBe("playing");
    expect(projectView(next, 0).board[1]?.face).toBe("known");
    expect(next.quiet).toBe(0);
    const history = new JunqiUndoHistory();
    history.record(initial, next);
    const restored = history.restore(1, next.revision)!;
    expect(restored).toEqual({ ...original, revision: next.revision + 1 });
    const view = projectView(restored, 0);
    expect(view.board[1]?.face).toBe("covered");
    expect(view.board[25]).not.toHaveProperty("kind");
    expect(view.candidates).toEqual(original.knowledge[0]);
    expect(view).not.toHaveProperty("positions");
    expect(view).not.toHaveProperty("seed");
    const replayed = applyAction(
      restored,
      { type: "move", from: 30, to: 25 },
      0,
    );
    expect(replayed).toEqual({ ...next, revision: restored.revision + 1 });
    expect(initial).toEqual(original);
  });

  it("撤销首翻及回应后重新定边，旧的阵营和重复计数不残留", () => {
    const initial = createInitialState("flip", 87);
    const firstAt = initial.board.findIndex(
      (piece) => piece?.side === 1 && piece.kind === "flag",
    );
    const otherAt = initial.board.findIndex((piece) => piece?.side === 0);
    const first = applyAction(initial, { type: "flip", at: firstAt }, 0);
    const second = applyAction(first, { type: "flip", at: otherAt }, 1);
    const history = new JunqiUndoHistory();
    history.record(initial, first);
    history.record(first, second);
    const restored = history.restore(2, second.revision)!;
    expect(restored).toEqual({ ...initial, revision: 3 });
    expect(projectView(restored, 0).viewerSide).toBeNull();
    expect(projectView(restored, 1).board[firstAt]).not.toHaveProperty("kind");
    const changed = applyAction(restored, { type: "flip", at: otherAt }, 0);
    expect(projectView(changed, 0).viewerSide).toBe(0);
    expect(changed.positions).toEqual(
      applyAction(initial, { type: "flip", at: otherAt }, 0).positions,
    );
  });

  it("历史有界，耗尽后不能回退且清理释放旧真值", () => {
    const history = new JunqiUndoHistory();
    let before = createInitialState("flip", 87);
    for (let i = 0; i < UNDO_HISTORY_LIMIT + 5; i++) {
      const after = {
        ...before,
        ply: before.ply + 1,
        revision: before.revision + 1,
      };
      history.record(before, after);
      before = after;
    }
    expect(history.depth).toBe(UNDO_HISTORY_LIMIT);
    for (let i = 0; i < UNDO_HISTORY_LIMIT; i++)
      expect(history.restore(1, 200 + i)).not.toBeNull();
    expect(history.restore(1, 300)).toBeNull();
    expect(history.depth).toBe(0);
    history.record(before, { ...before, ply: before.ply + 1 });
    history.clear();
    expect(history.restore(1, 301)).toBeNull();
  });
});
