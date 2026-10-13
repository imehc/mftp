import { describe, expect, it } from "vitest";

import { createSnookerState } from "./snooker";
import { snookerRuleActions } from "./snooker-rule-actions";

describe("斯诺克有效规则操作", () => {
  it("普通回合和正在放置母球时不保留空操作入口", () => {
    const state = createSnookerState(6);
    expect(
      Object.values(snookerRuleActions({ ...state, ballInHand: true })).some(
        Boolean,
      ),
    ).toBe(false);
    expect(
      Object.values(
        snookerRuleActions({
          ...state,
          ballInHand: false,
          placementRegion: null,
        }),
      ).some(Boolean),
    ).toBe(false);
  });

  it("已放置但仍可调整母球时显示调整入口", () => {
    expect(
      snookerRuleActions({ ...createSnookerState(6), ballInHand: false })
        .reposition,
    ).toBe(true);
  });

  it("仅剩黑球且分差超过七分时显示结束本局", () => {
    const state = {
      ...createSnookerState(6),
      on: { kind: "clearance" as const, color: 7 },
      scores: [20, 12],
    };
    expect(snookerRuleActions(state).claim).toBe(true);
    expect(snookerRuleActions({ ...state, scores: [19, 12] }).claim).toBe(
      false,
    );
  });

  it("待处理决策保留标记，结束后无规则操作", () => {
    const state = {
      ...createSnookerState(6),
      decision: { kind: "black-choice" as const, seat: 0 },
    };
    expect(snookerRuleActions(state).decision).toBe(true);
    expect(
      Object.values(snookerRuleActions({ ...state, finished: true })).some(
        Boolean,
      ),
    ).toBe(false);
  });
});
