import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";

import { searchChess } from "./ai-search";
import { chessCheckpointSchema, parseChessMove } from "./checkpoint";
import {
  applyChessMove,
  chessGame,
  claimReason,
  createChessState,
  legalTurns,
  positionKey,
} from "./rules";
import type { ChessState } from "./types";

function play(state: ChessState, san: string): ChessState {
  const move = new Chess(state.fen).move(san);
  return applyChessMove(
    state,
    {
      type: "move",
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion as "q" } : {}),
    },
    chessGame.currentSeat(state)!,
  ).state;
}

describe("国际象棋规则与存档", () => {
  it("白方先行，初始二十种合法着法，非法方不能落子", () => {
    const state = createChessState();
    expect(chessGame.currentSeat(state)).toBe(0);
    expect(legalTurns(state)).toHaveLength(20);
    expect(() =>
      applyChessMove(state, { type: "move", from: "e2", to: "e4" }, 1),
    ).toThrow();
  });

  it("将死与逼和分别判定，不能吃掉国王", () => {
    let state = createChessState();
    for (const move of ["f3", "e5", "g4", "Qh4#"]) state = play(state, move);
    expect(state.result).toBe("checkmate");
    expect(state.winnerSeat).toBe(1);
    expect(createChessState("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").result).toBe(
      "stalemate",
    );
  });

  it("易位同时移动王和车，不能穿过受攻击的格子", () => {
    const state = createChessState("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const result = applyChessMove(
      state,
      { type: "move", from: "e1", to: "g1" },
      0,
    );
    expect(result.presentation.rook).toEqual({ from: "h1", to: "f1" });
    expect(new Chess(result.state.fen).get("f1")?.type).toBe("r");
    expect(
      legalTurns(
        createChessState("r3k2r/8/8/8/2b5/8/8/R3K2R w KQkq - 0 1"),
        "e1",
      ),
    ).not.toContainEqual({ from: "e1", to: "g1" });
  });

  it("吃过路兵移除旁格兵，暴露己王的吃法被拒绝", () => {
    const result = applyChessMove(
      createChessState("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1"),
      { type: "move", from: "e5", to: "d6" },
      0,
    );
    expect(result.presentation.capture).toBe("d5");
    expect(new Chess(result.state.fen).get("d5")).toBeUndefined();
    expect(
      legalTurns(createChessState("k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1"), "e5"),
    ).not.toContainEqual({ from: "e5", to: "d6" });
  });

  it("升变支持后车象马，必须完整指定", () => {
    const state = createChessState("7k/P7/8/8/8/8/8/7K w - - 0 1");
    expect(
      legalTurns(state, "a7")
        .map((move) => move.promotion)
        .sort(),
    ).toEqual(["b", "n", "q", "r"]);
    for (const promotion of ["q", "r", "b", "n"] as const) {
      expect(
        new Chess(
          applyChessMove(
            state,
            { type: "move", from: "a7", to: "a8", promotion },
            0,
          ).state.fen,
        ).get("a8")?.type,
      ).toBe(promotion);
    }
    expect(() =>
      applyChessMove(state, { type: "move", from: "a7", to: "a8" }, 0),
    ).toThrow();
  });

  it("三次重复可申领、五次自动和棋，预声明着法不改变棋盘", () => {
    let state = createChessState();
    const cycle = ["Nf3", "Nf6", "Ng1", "Ng8"];
    for (const san of [...cycle, ...cycle.slice(0, 3)])
      state = play(state, san);
    const intended = { from: "f6", to: "g8" } as const;
    expect(claimReason(state, intended)).toBe("threefold");
    const claimed = applyChessMove(state, { type: "claim", intended }, 1).state;
    expect(claimed.fen).toBe(state.fen);
    state = play(state, "Ng8");
    expect(state.result).toBeNull();
    expect(claimReason(state)).toBe("threefold");
    for (const san of [...cycle, ...cycle]) state = play(state, san);
    expect(state.result).toBe("fivefold");
  });

  it("五十步申领与七十五步自动和棋分开，最后一步将死优先", () => {
    expect(
      claimReason(createChessState("7k/8/8/8/8/8/R7/K7 w - - 100 51")),
    ).toBe("fifty");
    expect(createChessState("7k/8/8/8/8/8/R7/K7 w - - 150 76").result).toBe(
      "seventy-five",
    );
    expect(
      play(createChessState("7k/5Q2/6K1/8/8/8/8/8 w - - 149 76"), "Qg7#")
        .result,
    ).toBe("checkmate");
  });

  it("局面键忽略步数与不可用的过路兵目标", () => {
    const a = new Chess(
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
    );
    const b = new Chess(
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 12 9",
    );
    expect(positionKey(a)).toBe(positionKey(b));
  });

  it("存档逐步重放，拒绝伪造重复历史和篡改局面", () => {
    const initial = createChessState(),
      next = play(initial, "e4");
    const checkpoint = {
      version: 1,
      gameId: "chess",
      id: crypto.randomUUID(),
      savedAt: Date.now(),
      mode: { kind: "hotseat" },
      history: [initial, next],
    };
    expect(chessCheckpointSchema.safeParse(checkpoint).success).toBe(true);
    expect(
      chessCheckpointSchema.safeParse({
        ...checkpoint,
        history: [
          initial,
          { ...next, positions: [...next.positions, ...next.positions] },
        ],
      }).success,
    ).toBe(false);
    expect(parseChessMove({ type: "move", from: "e2", to: "e9" })).toBeNull();
    expect(
      parseChessMove({ type: "move", from: "e2", to: "e4", unknown: true }),
    ).toBeNull();
  });

  it("AI 找到一步将杀并返回合法走法", () => {
    const state = createChessState("7k/5Q2/6K1/8/8/8/8/8 w - - 0 1");
    const move = searchChess(state, "hard");
    expect(applyChessMove(state, move, 0).state.result).toBe("checkmate");
    const initial = createChessState();
    expect(() =>
      applyChessMove(initial, searchChess(initial, "easy"), 0),
    ).not.toThrow();
  });
});
