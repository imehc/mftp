import { describe, expect, it } from "vitest";

import { selectionLayout, shortestAngle } from "./selection-layout";

describe("球桌选球布局与转杆方向", () => {
  it("跨正负 π 沿最短方向转动", () => {
    expect(shortestAngle(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(
      Math.PI + 0.1,
    );
    expect(shortestAngle(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(
      -Math.PI - 0.1,
    );
  });

  it("桌面六球同排，窄屏六球均分两排，均相对球桌居中", () => {
    const wide = selectionLayout(
      6,
      { x: 100, y: 100, width: 1100, height: 600 },
      false,
    );
    expect(new Set(wide.map((option) => option.y)).size).toBe(1);
    expect((wide[0].x + wide[5].x) / 2).toBe(650);
    const narrow = selectionLayout(
      6,
      { x: 20, y: 20, width: 260, height: 600 },
      true,
    );
    expect(new Set(narrow.map((option) => option.y)).size).toBe(2);
    expect((narrow[0].x + narrow[2].x) / 2).toBe(150);
  });

  it.each([6, 20])("%i 个候选的点击范围不重叠且完整位于台内", (count) => {
    const options = selectionLayout(
      count,
      { x: 20, y: 20, width: 260, height: 480 },
      true,
    );
    for (const option of options) {
      expect(option.x - 26).toBeGreaterThanOrEqual(20);
      expect(option.x + 26).toBeLessThanOrEqual(280);
      expect(option.y - 26).toBeGreaterThanOrEqual(20);
      expect(option.y + 45).toBeLessThanOrEqual(500);
    }
    for (const [index, first] of options.entries())
      for (const second of options.slice(index + 1))
        expect(
          Math.hypot(first.x - second.x, first.y - second.y),
        ).toBeGreaterThanOrEqual(52);
  });
});
