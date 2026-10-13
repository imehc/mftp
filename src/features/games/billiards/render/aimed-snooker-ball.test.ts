import { describe, expect, it } from "vitest";

import { SNOOKER } from "../equipment";
import { createNineBallState } from "../nine-ball";
import { createSnookerState } from "../snooker";
import { snookerValue } from "../snooker-equipment";
import type { BallState, SnookerState } from "../types";
import { aimedSnookerBall } from "./aimed-snooker-ball";

function ball(id: number, x: number, y = 0, potted = false): BallState {
  return { id, x, y, potted };
}

function position(
  balls: BallState[],
  patch: Partial<SnookerState> = {},
): SnookerState {
  return { ...createSnookerState(6), ballInHand: false, balls, ...patch };
}

describe("斯诺克瞄准分值目标", () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 22])(
    "显示球 %i 的实际分值，而不是本杆提名值",
    (id) => {
      const state = position([ball(0, -0.5), ball(id, 0.5)], {
        on: { kind: "color", nominated: 3 },
        freeBall: true,
        nominatedFree: 7,
      });
      const target = aimedSnookerBall(state, 0);
      expect(target?.id).toBe(id);
      expect(snookerValue(target!.id)).toBe(id >= 8 ? 1 : id);
    },
  );

  it("只显示无遮挡的首碰球，不透过近球显示远球", () => {
    const state = position([ball(0, -0.5), ball(7, 0.8), ball(8, 0.2)]);
    expect(aimedSnookerBall(state, 0)?.id).toBe(8);
    expect(
      aimedSnookerBall({ ...state, balls: [...state.balls].reverse() }, 0)?.id,
    ).toBe(8);
  });

  it("考虑母球直径扫掠，可擦边接触但不提示偏离的球", () => {
    const diameter = SNOOKER.ballRadius * 2;
    expect(
      aimedSnookerBall(
        position([ball(0, -0.5), ball(5, 0.5, diameter * 0.95)]),
        0,
      )?.id,
    ).toBe(5);
    expect(
      aimedSnookerBall(
        position([ball(0, -0.5), ball(5, 0.5, diameter * 1.05)]),
        0,
      ),
    ).toBe(null);
  });

  it("忽略已进袋、母球和后方球，按实际角度选择", () => {
    const state = position([
      ball(0, 0),
      ball(7, -0.5),
      ball(8, 0.3, 0, true),
      ball(5, 0.5),
    ]);
    expect(aimedSnookerBall(state, 0)?.id).toBe(5);
    expect(aimedSnookerBall(state, Math.PI)?.id).toBe(7);
    expect(aimedSnookerBall(state, Math.PI / 2)).toBe(null);
  });

  it("不穿过库边或袋口提示球", () => {
    expect(
      aimedSnookerBall(
        position([ball(0, 0), ball(7, SNOOKER.tableWidth / 2 + 0.2)]),
        0,
      ),
    ).toBe(null);
  });

  it("非斯诺克、手中球、结束或没有母球时不显示", () => {
    const state = position([ball(0, -0.5), ball(7, 0.5)]);
    expect(aimedSnookerBall(createNineBallState(), 0)).toBe(null);
    expect(aimedSnookerBall({ ...state, ballInHand: true }, 0)).toBe(null);
    expect(aimedSnookerBall({ ...state, finished: true }, 0)).toBe(null);
    expect(aimedSnookerBall({ ...state, balls: [ball(7, 0.5)] }, 0)).toBe(null);
  });
});
