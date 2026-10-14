import { expect, it } from "vitest";

import { billiardsCheckpointSchema } from "../billiards/checkpoint";
import { createNineBallState } from "../billiards/nine-ball";
import { createInitialState } from "../billiards/rules";
import { createSnookerState } from "../billiards/snooker";
import { createInitialGoState, goGame } from "../go/rules";
import { goCheckpointSchema } from "../go/session";
import { createInitialGomokuState, gomokuGame } from "../gomoku/rules";
import { gomokuCheckpointSchema } from "../gomoku/session";
import { createInitialXiangqiState, xiangqiGame } from "../xiangqi/rules";
import { xiangqiCheckpointSchema } from "../xiangqi/session";

function checkpoint(gameId: string, mode: unknown, history: unknown[]) {
  return {
    version: 1,
    gameId,
    id: crypto.randomUUID(),
    savedAt: Date.now(),
    mode,
    history,
  };
}

it("五子棋真实落子后的检查点保留完整历史", async () => {
  const initial = createInitialGomokuState();
  const next = await gomokuGame.applyMove(initial, { row: 7, col: 7 }, 0);
  expect(
    gomokuCheckpointSchema.safeParse(
      checkpoint("gomoku", { kind: "hotseat" }, [initial, next.state]),
    ).success,
  ).toBe(true);
});

it("象棋真实走法后的检查点保留重复局面计数", async () => {
  const initial = createInitialXiangqiState();
  const next = await xiangqiGame.applyMove(initial, { from: 54, to: 45 }, 0);
  const saved = xiangqiCheckpointSchema.parse(
    checkpoint("xiangqi", { kind: "ai", difficulty: "hard", localSeat: 1 }, [
      initial,
      next.state,
    ]),
  );
  expect(saved.history[1].positionCounts).toEqual(next.state.positionCounts);
});

it.each([9, 13, 19] as const)(
  "围棋 %i 路保留超级劫历史与停手状态",
  async (boardSize) => {
    const initial = createInitialGoState(boardSize);
    const next = await goGame.applyMove(
      initial,
      { kind: "play", row: 0, col: 0 },
      0,
    );
    const passed = await goGame.applyMove(next.state, { kind: "pass" }, 1);
    const saved = goCheckpointSchema.parse(
      checkpoint("go", { kind: "hotseat", boardSize }, [
        initial,
        next.state,
        passed.state,
      ]),
    );
    expect(saved.history[2].positionHistory).toEqual(
      passed.state.positionHistory,
    );
    expect(saved.history[2].consecutivePasses).toBe(1);
  },
);

it.each([6, 10, 15] as const)(
  "斯诺克 %i 红球对战与练习均能恢复器材和规则状态",
  (reds) => {
    for (const kind of ["hotseat", "practice"] as const) {
      const state =
        kind === "practice"
          ? createInitialState("practice", 0, "snooker", 42, reds)
          : createSnookerState(reds, 0, 42);
      const saved = checkpoint(
        "billiards",
        { kind, discipline: "snooker", reds },
        [state],
      );
      expect(billiardsCheckpointSchema.safeParse(saved).success).toBe(true);
    }
  },
);

it("八球与九球检查点包含球组、开球种子与犯规计数", () => {
  for (const [discipline, state] of [
    ["eight-ball", createInitialState("eight-ball", 1)],
    ["nine-ball", createNineBallState(1, 42)],
  ] as const) {
    const saved = checkpoint(
      "billiards",
      { kind: "ai", discipline, difficulty: "medium", playerBreaks: false },
      [state],
    );
    expect(billiardsCheckpointSchema.safeParse(saved).success).toBe(true);
  }
});

it("拒绝跨游戏、联机存档、棋盘规格错配和非法球编号", () => {
  expect(
    gomokuCheckpointSchema.safeParse(
      checkpoint("xiangqi", { kind: "hotseat" }, [createInitialGomokuState()]),
    ).success,
  ).toBe(false);
  expect(
    gomokuCheckpointSchema.safeParse(
      checkpoint("gomoku", { kind: "online" }, [createInitialGomokuState()]),
    ).success,
  ).toBe(false);
  expect(
    goCheckpointSchema.safeParse(
      checkpoint("go", { kind: "hotseat", boardSize: 9 }, [
        createInitialGoState(19),
      ]),
    ).success,
  ).toBe(false);
  const state = createNineBallState(0, 42);
  state.balls[1].id = 20;
  expect(
    billiardsCheckpointSchema.safeParse(
      checkpoint("billiards", { kind: "hotseat", discipline: "nine-ball" }, [
        state,
      ]),
    ).success,
  ).toBe(false);
});
