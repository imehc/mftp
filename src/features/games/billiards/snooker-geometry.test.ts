import { beforeAll, describe, expect, it } from "vitest";

import { createBilliardsAiStrategy } from "./ai";
import { ballDefinition } from "./ball-definitions";
import { SNOOKER } from "./equipment";
import { ensurePhysicsReady, simulateShot } from "./physics";
import { legalCuePlacement } from "./placement";
import { defaultAim } from "./render/default-aim";
import { createSnookerState, reduceSnookerShot } from "./snooker";
import { applySnookerAction } from "./snooker-actions";
import {
  BAULK_X,
  COLOR_IDS,
  COLOR_SPOTS,
  createSnookerRack,
  D_RADIUS,
} from "./snooker-equipment";
import { respotColors } from "./snooker-respot";
import {
  findDPlacement,
  freeBallAvailable,
  snookeredBy,
  snookerVisibility,
  targetVisibility,
} from "./snooker-visibility";
import type { BallState, RedCount } from "./types";

const ball = (id: number, x: number, y: number): BallState => ({
  id,
  x,
  y,
  potted: false,
});

describe("斯诺克器材与复位", () => {
  it.each([6, 10, 15] as RedCount[])(
    "%i红球采用同一器材，球数和点位正确且无重叠",
    (reds) => {
      const balls = createSnookerRack(reds);
      expect(balls).toHaveLength(reds + 7);
      for (const id of COLOR_IDS)
        expect(balls.find((b) => b.id === id)).toMatchObject(COLOR_SPOTS[id]);
      for (let i = 0; i < balls.length; i++)
        for (let j = i + 1; j < balls.length; j++)
          expect(
            Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y),
          ).toBeGreaterThanOrEqual(0.0525 - 1e-12);
      // 红球 id 随种子打乱，用最靠近粉球的红球校验顶点间距。
      const apex = balls
        .filter((b) => b.id >= 8)
        .reduce((a, b) => (a.x < b.x ? a : b));
      expect(apex.x - COLOR_SPOTS[6].x).toBeGreaterThan(0.0525);
      expect(ballDefinition(8, "snooker")).toEqual(
        ballDefinition(reds + 7, "snooker"),
      );
      expect(ballDefinition(0, "snooker").spottedCue).toBe(false);
      expect(ballDefinition(8, "snooker").number).toBe(null);
    },
  );

  it("D区球心边界合法，D区朝向与彩球占位正确", () => {
    const state = createSnookerState(6);
    expect(legalCuePlacement(state, BAULK_X - D_RADIUS, 0)).toBe(true);
    expect(legalCuePlacement(state, BAULK_X - D_RADIUS - 0.00001, 0)).toBe(
      false,
    );
    expect(legalCuePlacement(state, BAULK_X + 0.00001, 0.1)).toBe(false);
    expect(legalCuePlacement(state, BAULK_X, 0)).toBe(false);
  });

  it("被占的原点使用最高空点，多球复位按高分优先", () => {
    const balls = [
      ball(0, -0.5, 0.2),
      ball(8, COLOR_SPOTS[7].x, 0),
      ball(9, COLOR_SPOTS[6].x, 0),
      ...COLOR_IDS.map((id) => ({ ...ball(id, 0, 0), potted: true })),
    ];
    const next = respotColors(balls, [6, 7]);
    expect(next.find((b) => b.id === 7)).toMatchObject(COLOR_SPOTS[5]);
    expect(next.find((b) => b.id === 6)).toMatchObject(COLOR_SPOTS[4]);
  });

  it("所有点被占后沿原点朝顶库寻找最近不接触位置", () => {
    const balls = [
      ...COLOR_IDS.map((id) =>
        ball(id + 10, COLOR_SPOTS[id].x, COLOR_SPOTS[id].y),
      ),
      { ...ball(5, 0, 0), potted: true },
    ];
    const next = respotColors(balls, [5]).find((b) => b.id === 5)!;
    expect(next.x).toBeCloseTo(0.0526, 9);
    expect(next.y).toBe(0);
    expect(
      balls
        .filter((b) => !b.potted)
        .every((b) => Math.hypot(b.x - next.x, b.y - next.y) > 0.0525),
    ).toBe(true);
  });

  it("黑球顶库方向全部被占时退向纵向中线另一侧", () => {
    const balls = [
      ...COLOR_IDS.map((id) =>
        ball(id + 10, COLOR_SPOTS[id].x, COLOR_SPOTS[id].y),
      ),
      { ...ball(7, 0, 0), potted: true },
    ];
    for (let i = 1; i < 7; i++)
      balls.push(ball(30 + i, COLOR_SPOTS[7].x + i * 0.0525, 0));
    const next = respotColors(balls, [7]).find((b) => b.id === 7)!;
    expect(next.x).toBeCloseTo(COLOR_SPOTS[7].x - 0.0526, 8);
  });
});

describe("斯诺克连续能见性与有效障碍", () => {
  const cue = ball(0, -0.5, 0);
  const target = ball(8, 0.5, 0);

  it("中心线通畅但一侧极薄边被挡仍是斯诺克", () => {
    const obstacle = ball(7, 0, 0.07);
    expect(targetVisibility(cue, target, [obstacle])).toMatchObject({
      full: true,
      bothEdges: false,
      any: true,
    });
    expect(
      freeBallAvailable({
        balls: [cue, target, obstacle],
        on: { kind: "red" },
        placementRegion: null,
      }),
    ).toBe(true);
  });

  it("目标后的球不算遮挡，完全挡住和只剩薄边可擦区分开", () => {
    expect(targetVisibility(cue, target, [ball(7, 0.7, 0)]).bothEdges).toBe(
      true,
    );
    expect(targetVisibility(cue, target, [ball(7, 0, 0)]).any).toBe(false);
    expect(targetVisibility(cue, target, [ball(7, 0, 0.03)])).toMatchObject({
      full: false,
      bothEdges: false,
      any: true,
    });
  });

  it("相切阈值两侧可区分，不以中心线取代极薄边", () => {
    const tangentY =
      (0.0525 / Math.sqrt(1 - 0.0525 ** 2)) * 0.5 +
      0.0525 / Math.sqrt(1 - 0.0525 ** 2);
    expect(
      targetVisibility(cue, target, [ball(7, 0, tangentY + 1e-6)]).bothEdges,
    ).toBe(true);
    expect(
      targetVisibility(cue, target, [ball(7, 0, tangentY - 1e-6)]).bothEdges,
    ).toBe(false);
  });

  it("D区当前点被挡但其他位置可见时不宣判自由球", () => {
    const balls = [ball(0, -1.2, 0), ball(8, 0.5, 0), ball(7, -0.7, 0)];
    expect(snookerVisibility({ balls, on: { kind: "red" } }).bothEdges).toBe(
      false,
    );
    const spot = findDPlacement(balls, { kind: "red" });
    expect(spot).not.toBe(null);
    expect(
      snookerVisibility({ balls, on: { kind: "red" } }, spot!).bothEdges,
    ).toBe(true);
    expect(
      freeBallAvailable({ balls, on: { kind: "red" }, placementRegion: "d" }),
    ).toBe(false);
  });

  it("D区全部方向被近目标球挡住时可提名自由球", () => {
    const balls = [ball(0, -1.2, 0), ball(8, 0.5, 0), ball(7, 0.4, 0)];
    expect(findDPlacement(balls, { kind: "red" })).toBe(null);
    expect(
      freeBallAvailable({ balls, on: { kind: "red" }, placementRegion: "d" }),
    ).toBe(true);
  });

  it("多个障碍只取最近者，不同红球由不同球做障碍时无有效球", () => {
    expect(
      snookeredBy(
        {
          balls: [cue, target, ball(7, 0, 0), ball(5, 0.2, 0)],
          on: { kind: "red" },
        },
        7,
      ),
    ).toBe(true);
    expect(
      snookeredBy(
        {
          balls: [cue, target, ball(7, 0, 0), ball(5, 0.2, 0)],
          on: { kind: "red" },
        },
        5,
      ),
    ).toBe(false);
    const balls = [
      cue,
      ball(8, 0.5, 0.3),
      ball(9, 0.5, -0.3),
      ball(7, 0, 0.15),
      ball(5, 0, -0.15),
    ];
    expect(snookeredBy({ balls, on: { kind: "red" } }, 7)).toBe(false);
    expect(snookeredBy({ balls, on: { kind: "red" } }, 5)).toBe(false);
  });
});

describe("斯诺克真实物理与AI接入", () => {
  beforeAll(ensurePhysicsReady);

  it.each([6, 10, 15] as RedCount[])(
    "%i红球开球可直达红球，AI使用同一物理和裁判",
    async (reds) => {
      const initial = createSnookerState(reds);
      const aim = defaultAim(initial, SNOOKER);
      expect(aim?.targetId).toBeGreaterThanOrEqual(8);
      const ai = createBilliardsAiStrategy(undefined, SNOOKER);
      const move = await ai.chooseMove(
        initial,
        0,
        "hard",
        new AbortController().signal,
      );
      expect(move.type).toBe("shot");
      if (move.type !== "shot") throw new Error("expected shot");
      const sim = await simulateShot(initial.balls, move, false, SNOOKER);
      expect(sim.facts.firstContacts.length).toBeGreaterThan(0);
      expect(sim.facts.firstContacts.every((id) => id >= 8)).toBe(true);
      const next = reduceSnookerShot(initial, sim, move);
      expect(next.shotCount).toBe(1);
      // 首碰已是红球，裁判不应判错球；母球是否入袋取决于 AI 选线，不在此固定。
      expect([null, "cue-potted"]).toContain(next.lastOutcome?.foul);
    },
  );

  it("AI先完成选彩、漏击警告和D区放置，不在决策中出杆", async () => {
    const ai = createBilliardsAiStrategy(undefined, SNOOKER);
    const signal = new AbortController().signal;
    const initial = {
      ...createSnookerState(6),
      on: { kind: "color" as const, nominated: null },
    };
    expect((await ai.chooseMove(initial, 0, "hard", signal)).type).toBe(
      "nominate",
    );
    const placing = { ...createSnookerState(6), ballInHand: true };
    const place = await ai.chooseMove(placing, 0, "hard", signal);
    expect(place.type).toBe("place-cue");
    if (place.type === "place-cue")
      expect(applySnookerAction(placing, place).ballInHand).toBe(false);
    const warned = {
      ...initial,
      decision: {
        kind: "foul" as const,
        shooter: 0,
        seat: 1,
        replace: null,
        anywhere: false,
        warning: "six-red" as const,
      },
    };
    expect(await ai.chooseMove(warned, 0, "hard", signal)).toEqual({
      type: "decision",
      choice: "acknowledge",
    });
  });
});
