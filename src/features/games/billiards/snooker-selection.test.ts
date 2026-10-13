import { describe, expect, it } from "vitest";

import { createSnookerState } from "./snooker";
import { COLOR_IDS } from "./snooker-equipment";
import { snookerSelection } from "./snooker-selection";

describe("斯诺克顶部选球候选项", () => {
  it("打红球时不能选彩，打彩球时保留全部六种颜色", () => {
    const state = createSnookerState(6);
    expect(snookerSelection(state).editable).toBe(false);
    expect(snookerSelection(state).colors).toEqual([]);
    const selecting = snookerSelection({
      ...state,
      on: { kind: "color", nominated: null },
    });
    expect(selecting.editable).toBe(true);
    expect(selecting.colors).toEqual(COLOR_IDS);
  });

  it("自由球排除母球、已进袋球和全部本杆合法目标", () => {
    const state = createSnookerState(6);
    const selection = snookerSelection({
      ...state,
      freeBall: true,
      balls: state.balls.map((ball) =>
        ball.id === 7 ? { ...ball, potted: true } : ball,
      ),
    });
    expect(selection.editable).toBe(true);
    expect(selection.free).toEqual([2, 3, 4, 5, 6]);
  });

  it("清彩阶段只能从非目标球中提名自由球", () => {
    const state = {
      ...createSnookerState(6),
      freeBall: true,
      on: { kind: "clearance" as const, color: 2 },
    };
    expect(snookerSelection(state).free).not.toContain(2);
    expect(snookerSelection(state).colors).toEqual([]);
  });

  it("决策和结束时禁用交互，但仍保留彩球候选信息", () => {
    const state = {
      ...createSnookerState(6),
      on: { kind: "color" as const, nominated: 5 },
    };
    expect(snookerSelection({ ...state, finished: true }).editable).toBe(false);
    expect(
      snookerSelection({
        ...state,
        decision: { kind: "black-choice", seat: 0 },
      }).editable,
    ).toBe(false);
    expect(snookerSelection({ ...state, finished: true }).colors).toEqual(
      COLOR_IDS,
    );
  });
});
