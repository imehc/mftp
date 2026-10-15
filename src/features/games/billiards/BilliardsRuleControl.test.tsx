import { describe, expect, it, vi } from "vitest";

import { BilliardsRuleControl } from "./BilliardsRuleControl";
import { createNineBallState } from "./nine-ball";
import { createSnookerState } from "./snooker";
import type { BilliardsState } from "./types";

function fixture(state: BilliardsState, enabled = true) {
  const onReposition = vi.fn();
  const onOpenChange = vi.fn();
  const onProposeStalemate = vi.fn();
  const control = BilliardsRuleControl({
    state,
    enabled,
    open: false,
    pushOut: false,
    onReposition,
    onOpenChange,
    onProposeStalemate,
  });
  return { control, onReposition, onOpenChange, onProposeStalemate };
}

describe("台球底部规则入口", () => {
  it.each([6, 15] as const)(
    "%i 红球开局直接调整母球，不先打开操作弹层",
    (reds) => {
      const { control, onReposition, onOpenChange } = fixture(
        createSnookerState(reds),
      );
      expect(control).not.toBeNull();
      expect(control?.props["aria-haspopup"]).toBeUndefined();
      control?.props.onClick();
      expect(onReposition).toHaveBeenCalledOnce();
      expect(onOpenChange).not.toHaveBeenCalled();
    },
  );

  it("需要在调整母球和结束本局之间选择时保留弹层", () => {
    const { control, onReposition, onOpenChange } = fixture({
      ...createSnookerState(6),
      on: { kind: "clearance", color: 7 },
      scores: [20, 12],
    });
    expect(control?.props["aria-haspopup"]).toBe("dialog");
    control?.props.onClick();
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(onReposition).not.toHaveBeenCalled();
  });

  it("九球有调整母球等多个操作时保留弹层", () => {
    const { control, onOpenChange, onReposition } = fixture(
      createNineBallState(),
    );
    expect(control?.props["aria-haspopup"]).toBe("dialog");
    control?.props.onClick();
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(onReposition).not.toHaveBeenCalled();
  });

  it("九球只剩提议重摆时直接操作，不先打开弹层", () => {
    const { control, onOpenChange, onProposeStalemate } = fixture({
      ...createNineBallState(),
      breakDone: true,
      placementRegion: null,
    });
    expect(control?.props["aria-haspopup"]).toBeUndefined();
    expect(control?.props["aria-expanded"]).toBeUndefined();
    expect(control?.props.children.props.children.props.message).toBe(
      "提议重摆",
    );
    control?.props.onClick();
    expect(onProposeStalemate).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("九球正在放置母球时不把不可用的重复调整计为第二个操作", () => {
    const { control, onProposeStalemate, onOpenChange } = fixture({
      ...createNineBallState(),
      ballInHand: true,
    });
    control?.props.onClick();
    expect(onProposeStalemate).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("九球可以声明推杆或需要处理警告时仍打开规则弹层", () => {
    for (const state of [
      {
        ...createNineBallState(),
        placementRegion: null,
        pushOutAvailable: true,
      },
      {
        ...createNineBallState(),
        placementRegion: null,
        decision: { kind: "warning" as const, seat: 0 },
      },
    ]) {
      const { control, onProposeStalemate, onOpenChange } = fixture(state);
      expect(control?.props["aria-haspopup"]).toBe("dialog");
      control?.props.onClick();
      expect(onOpenChange).toHaveBeenCalledWith(true);
      expect(onProposeStalemate).not.toHaveBeenCalled();
    }
  });

  it("九球的单操作在非本地可操作回合仍禁用", () => {
    const { control } = fixture(
      { ...createNineBallState(), placementRegion: null },
      false,
    );
    expect(control?.props.disabled).toBe(true);
  });

  it("正在放置母球时不显示重复入口", () => {
    const { control } = fixture({
      ...createSnookerState(6),
      ballInHand: true,
    });
    expect(control).toBeNull();
  });

  it("非本地可操作回合禁用调整入口", () => {
    const { control } = fixture(createSnookerState(6), false);
    expect(control?.props.disabled).toBe(true);
  });
});
