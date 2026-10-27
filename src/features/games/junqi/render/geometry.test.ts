import { describe, expect, it } from "vitest";

import { cellPosition, viewSize } from "./geometry";

describe("军棋横竖屏坐标", () => {
  it("横屏只旋转布局，翻转后坐标镜像且所有触控中心仍在视口内", () => {
    for (const landscape of [false, true]) {
      const size = viewSize(landscape);
      for (let index = 0; index < 60; index++) {
        const a = cellPosition(index, false, landscape),
          b = cellPosition(index, true, landscape);
        expect(a.x).toBeCloseTo(-b.x);
        expect(a.y).toBeCloseTo(-b.y);
        expect(Math.abs(a.x) + 0.5).toBeLessThan(size.width / 2);
        expect(Math.abs(a.y) + 0.5).toBeLessThan(size.height / 2);
        for (let other = index + 1; other < 60; other++) {
          const c = cellPosition(other, false, landscape);
          expect(
            Math.max(Math.abs(c.x - a.x), Math.abs(c.y - a.y)),
          ).toBeGreaterThanOrEqual(0.999);
        }
      }
    }
  });
});
