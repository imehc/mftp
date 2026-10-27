import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";

import { junqiAi } from "./ai";
import { isCamp } from "./board";
import { junqiCheckpointSchema } from "./checkpoint";
import { validDeployment } from "./deployment";
import { chooseObservedMove } from "./observed-ai";
import { applyAction, createInitialState, positionKey } from "./rules";
import {
  type FlipState,
  type HiddenState,
  type JunqiState,
  PIECE_COUNTS,
  type PieceKind,
} from "./types";
import { projectView, viewActions, viewDestinations } from "./visibility";

beforeAll(() => {
  i18n.load("zh-CN", {});
  i18n.activate("zh-CN");
});

function hiddenGame(): HiddenState {
  let state = createInitialState("hidden", 91);
  state = applyAction(state, { type: "ready" }, 0);
  state = applyAction(state, { type: "ready" }, 1);
  if (state.variant !== "hidden") throw new Error("invalid fixture");
  return state;
}

function flipGame(): FlipState {
  const state = createInitialState("flip", 87);
  if (state.variant !== "flip") throw new Error("invalid fixture");
  return state;
}

function checkpoint(history: JunqiState[]) {
  return {
    version: 1,
    gameId: "junqi",
    id: crypto.randomUUID(),
    savedAt: 1,
    mode: {
      kind: "ai",
      difficulty: "medium",
      localSeat: 0,
      variant: history[0].variant,
    },
    history,
  };
}

describe("军棋暗棋规则与观察边界", () => {
  it("随机布阵合法、标识不带种类，交换隐藏身份不改变对手视图", () => {
    const state = hiddenGame();
    expect(validDeployment(state.board, 0)).toBe(true);
    expect(validDeployment(state.board, 1)).toBe(true);
    expect(new Set(state.board.filter(Boolean).map((p) => p?.id)).size).toBe(
      50,
    );
    for (const piece of state.board)
      if (piece) expect(piece.id).toMatch(/^p\d+$/);
    const view = projectView(state, 0);
    expect(
      view.board.filter((p) => p?.side === 1).every((p) => p && !("kind" in p)),
    ).toBe(true);
    const altered = structuredClone(state);
    const enemies = altered.board.filter(
      (p) => p?.side === 1 && p.kind !== "flag" && p.kind !== "mine",
    );
    if (!enemies[0] || !enemies[1]) throw new Error("missing fixture");
    [enemies[0].kind, enemies[1].kind] = [enemies[1].kind, enemies[0].kind];
    altered.seed++;
    expect(projectView(altered, 0)).toEqual(view);
    expect(view).not.toHaveProperty("seed");
    expect(view).not.toHaveProperty("positions");
  });

  it.each(["bomb", "commander"] as const)(
    "司令与%s同归于尽后永久亮旗，不泄露其他身份",
    (attacker) => {
      const state = hiddenGame();
      state.board = Array(60).fill(null);
      state.board[30] = { id: "a", side: 0, kind: attacker };
      state.board[25] = { id: "b", side: 1, kind: "commander" };
      state.board[1] = { id: "flag", side: 1, kind: "flag" };
      state.board[20] = { id: "other", side: 1, kind: "engineer" };
      state.board[35] = { id: "ours", side: 0, kind: "platoon" };
      state.board[56] = { id: "own-flag", side: 0, kind: "flag" };
      state.positions = { [positionKey(state)]: 1 };
      const next = applyAction(state, { type: "move", from: 30, to: 25 }, 0);
      expect(next.variant === "hidden" && next.flagShown[1]).toBe(true);
      expect(projectView(next, 0).board[1]?.kind).toBe("flag");
      expect(projectView(next, 0).board[20]).not.toHaveProperty("kind");
      expect(projectView(next, 0).lastCombat).toBe("both");
      expect(state.flagShown).toEqual([false, false]);
    },
  );

  it("交战公开结果约束候选，存活敌子仍不直接公开身份", () => {
    const state = hiddenGame();
    state.board = Array(60).fill(null);
    state.board[30] = { id: "a", side: 0, kind: "platoon" };
    state.board[25] = { id: "b", side: 1, kind: "general" };
    state.board[1] = { id: "f1", side: 1, kind: "flag" };
    state.board[56] = { id: "f0", side: 0, kind: "flag" };
    state.board[35] = { id: "c", side: 0, kind: "engineer" };
    state.knowledge = [
      { b: ["commander", "general", "platoon", "engineer", "bomb", "mine"] },
      {},
    ];
    const next = applyAction(state, { type: "move", from: 30, to: 25 }, 0);
    const view = projectView(next, 0);
    expect(view.board[25]).not.toHaveProperty("kind");
    expect(view.candidates.b).toEqual(["commander", "general", "mine"]);
  });

  it.each(["easy", "medium", "hard"] as const)(
    "%s电脑在相同观察下不依赖隐藏身份或种子",
    async (difficulty) => {
      const state = hiddenGame(),
        other = structuredClone(state);
      for (const piece of other.board)
        if (piece?.side === 1 && piece.kind !== "flag") piece.kind = "bomb";
      other.seed++;
      const signal = new AbortController().signal;
      expect(projectView(other, 0)).toEqual(projectView(state, 0));
      const first = await junqiAi.chooseMove(state, 0, difficulty, signal);
      const second = await junqiAi.chooseMove(other, 0, difficulty, signal);
      expect(first).toEqual(second);
      expect(viewActions(projectView(state, 0))).toContainEqual(first);
    },
  );
});

describe("军棋翻棋规则", () => {
  it("多种种子保持配额与空行营，翻子前不公开阵营或身份", () => {
    for (let seed = 0; seed < 40; seed++) {
      const state = createInitialState("flip", seed);
      const pieces = state.board.filter((p) => p !== null);
      expect(pieces).toHaveLength(50);
      for (const side of [0, 1])
        for (const [kind, count] of Object.entries(PIECE_COUNTS))
          expect(
            pieces.filter((p) => p.side === side && p.kind === kind),
          ).toHaveLength(count);
      state.board.forEach((piece, index) => {
        if (isCamp(index)) expect(piece).toBeNull();
      });
      const view = projectView(state, 0);
      expect(
        view.board
          .filter(Boolean)
          .every(
            (p) => p?.face === "covered" && p.side === null && !("kind" in p),
          ),
      ).toBe(true);
      expect(viewActions(view)).toHaveLength(50);
      expect(createInitialState("flip", seed)).toEqual(state);
    }
  });

  it.each(["flag", "mine", "engineer"] as PieceKind[])(
    "首翻%s也可以定边，后续翻子不改变归属",
    (kind) => {
      const state = flipGame();
      const at = state.board.findIndex((p) => p?.kind === kind && p.side === 1);
      const next = applyAction(state, { type: "flip", at }, 0);
      expect(next.variant === "flip" && next.sides).toEqual([1, 0]);
      expect(projectView(next, 0).viewerSide).toBe(1);
      expect(projectView(next, 1).board[at]?.kind).toBe(kind);
      expect(next.turnSeat).toBe(1);
      expect(() => applyAction(next, { type: "flip", at }, 1)).toThrow();
      expect(() => applyAction(state, { type: "flip", at }, 1)).toThrow();
    },
  );

  it("盖子阻挡且不能被攻击，翻棋的大本营不锁子", () => {
    const state = flipGame();
    state.board = Array(60).fill(null);
    state.board[56] = { id: "own", side: 0, kind: "engineer" };
    state.board[51] = { id: "covered", side: 1, kind: "platoon" };
    state.board[50] = { id: "mine", side: 0, kind: "mine" };
    state.sides = [0, 1];
    state.revealed = ["own", "mine"];
    const view = projectView(state, 0);
    expect(viewDestinations(view, 56)).toContain(55);
    expect(viewDestinations(view, 56)).not.toContain(51);
    expect(viewDestinations(view, 50)).toEqual([]);
    expect(() =>
      applyAction(state, { type: "move", from: 56, to: 51 }, 0),
    ).toThrow();
    expect(
      applyAction(state, { type: "move", from: 56, to: 55 }, 0).phase,
    ).toBe("playing");
  });

  it("有盖子时不能以无棋可走判负，翻子重置无进展计数", () => {
    const state = flipGame();
    state.quiet = 99;
    const next = applyAction(state, { type: "flip", at: 0 }, 0);
    expect(next.quiet).toBe(0);
    expect(next.phase).toBe("playing");
    expect(next.ply).toBe(1);
  });
});

describe("军棋下一版存档", () => {
  it.each(["hidden", "flip"] as const)(
    "%s存档逐步重放并拒绝揭示与种子篡改",
    (variant) => {
      const history = [createInitialState(variant, 9)];
      for (let n = 0; n < 8; n++) {
        const current = history[history.length - 1];
        const action =
          current.phase === "deployment"
            ? { type: "ready" as const }
            : viewActions(projectView(current, current.turnSeat))[0];
        history.push(applyAction(current, action, current.turnSeat));
      }
      const saved = checkpoint(history);
      expect(junqiCheckpointSchema.safeParse(saved).success).toBe(true);
      const corrupt = structuredClone(saved);
      const last = corrupt.history[corrupt.history.length - 1];
      if (last.variant !== "open") last.seed++;
      expect(junqiCheckpointSchema.safeParse(corrupt).success).toBe(false);
      const wrongMode = {
        ...saved,
        mode: { ...saved.mode, variant: "open" },
      };
      expect(junqiCheckpointSchema.safeParse(wrongMode).success).toBe(false);
    },
  );

  it("受限信息策略取消后不返回走法", async () => {
    const controller = new AbortController();
    const pending = chooseObservedMove(
      projectView(hiddenGame(), 0),
      0,
      "hard",
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
