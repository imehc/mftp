import { describe, expect, it, vi } from "vitest";

import { BilliardsRuleControl } from "./BilliardsRuleControl";
import { createNineBallState } from "./nine-ball";
import { createSnookerState } from "./snooker";
import type { BilliardsState } from "./types";

function fixture(state: BilliardsState, enabled = true) {
  const onReposition = vi.fn();
  const onOpenChange = vi.fn();
  const control = BilliardsRuleControl({
    state,
    enabled,
    open: false,
    pushOut: false,
    onReposition,
    onOpenChange,
  });
  return { control, onReposition, onOpenChange };
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

  it("九球继续使用规则操作弹层", () => {
    const { control, onOpenChange, onReposition } = fixture(
      createNineBallState(),
    );
    expect(control?.props["aria-haspopup"]).toBe("dialog");
    control?.props.onClick();
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(onReposition).not.toHaveBeenCalled();
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
