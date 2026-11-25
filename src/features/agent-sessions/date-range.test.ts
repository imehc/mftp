import { describe, expect, it } from "vitest";

import { sessionDateBounds } from "./date-range";

describe("会话日期筛选", () => {
  it("使用本机日历日期并包含结束日期全天", () => {
    const bounds = sessionDateBounds("custom", "2026-11-24", "2026-11-24");
    expect(bounds).toEqual({
      valid: true,
      from: new Date(2026, 10, 24).getTime(),
      to: new Date(2026, 10, 25).getTime() - 1,
    });
  });

  it("最近七天从六天前的本机零点开始", () => {
    expect(
      sessionDateBounds("week", "", "", new Date(2026, 10, 24, 23)).from,
    ).toBe(new Date(2026, 10, 18).getTime());
  });

  it("拒绝不存在或倒置的日期", () => {
    expect(sessionDateBounds("custom", "2026-02-30", "").valid).toBe(false);
    expect(sessionDateBounds("custom", "2026-11-25", "2026-11-24").valid).toBe(
      false,
    );
  });

  it("允许只指定一侧日期并覆盖任意历史月份", () => {
    expect(sessionDateBounds("custom", "", "2026-11-24").from).toBeNull();
    expect(sessionDateBounds("month", "", "", new Date(), "2024-02")).toEqual({
      valid: true,
      from: new Date(2024, 1, 1).getTime(),
      to: new Date(2024, 2, 1).getTime() - 1,
    });
  });
});
