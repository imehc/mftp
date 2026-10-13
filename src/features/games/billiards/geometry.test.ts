import { describe, expect, it } from "vitest";

import { CHINESE_EIGHT } from "./equipment";
import { cushionSegments } from "./geometry";
import {
  POCKET_GEOMETRIES,
  pocketAt,
  pocketRayDistance,
  pocketWorld,
} from "./pocket-geometry";

/** 测量实际细分碰撞边界，不以袋心或贴图圆直径代替袋口净宽。 */
function separation(a: number[], b: number[]): number {
  let nearest = Infinity;
  for (let i = 0; i < a.length; i += 2) {
    for (let j = 0; j < b.length; j += 2) {
      const k = (j + 2) % b.length;
      const dx = b[k] - b[j];
      const dy = b[k + 1] - b[j + 1];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((a[i] - b[j]) * dx + (a[i + 1] - b[j + 1]) * dy) /
            (dx * dx + dy * dy),
        ),
      );
      nearest = Math.min(
        nearest,
        Math.hypot(a[i] - b[j] - t * dx, a[i + 1] - b[j + 1] - t * dy),
      );
    }
  }
  return nearest;
}

describe("中式八球袋口的实际内沿最近距离", () => {
  it("六个袋口的真实最窄距离符合器材配置", () => {
    const segments = cushionSegments();
    for (const [a, b, width] of [
      [0, 4, CHINESE_EIGHT.corner.width],
      [1, 5, CHINESE_EIGHT.corner.width],
      [2, 4, CHINESE_EIGHT.corner.width],
      [3, 5, CHINESE_EIGHT.corner.width],
      [0, 1, CHINESE_EIGHT.side.width],
      [2, 3, CHINESE_EIGHT.side.width],
    ]) {
      const first = segments[a].points;
      const second = segments[b].points;
      expect(
        Math.min(separation(first, second), separation(second, first)),
      ).toBeCloseTo(width, 6);
    }
  });

  it("弧形库边保持凸形，物理凸包不会填平真实袋颚", () => {
    for (const { points } of cushionSegments()) {
      const turns: number[] = [];
      for (let i = 0; i < points.length; i += 2) {
        const j = (i + 2) % points.length;
        const k = (i + 4) % points.length;
        turns.push(
          (points[j] - points[i]) * (points[k + 1] - points[j + 1]) -
            (points[j + 1] - points[i + 1]) * (points[k] - points[j]),
        );
      }
      expect(
        turns.every((t) => t >= -1e-10) || turns.every((t) => t <= 1e-10),
      ).toBe(true);
    }
  });

  it("六袋均须跨过支撑边且处在开孔内，辅助线采用同一边界", () => {
    for (const p of POCKET_GEOMETRIES) {
      const before = pocketWorld(p.spec, 0, p.supportDepth - 0.0001);
      const after = pocketWorld(p.spec, 0, p.supportDepth + 0.0001);
      expect(pocketAt(before)).toBeUndefined();
      expect(pocketAt(after)?.id).toBe(p.spec.id);
      expect(
        pocketAt(
          pocketWorld(p.spec, p.rearHalf + 0.001, p.supportDepth + 0.01),
        ),
      ).toBeUndefined();
      const origin = pocketWorld(p.spec, 0, p.supportDepth - 0.1);
      expect(
        pocketRayDistance(origin, { x: p.spec.dx, y: p.spec.dy }, 1),
      ).toBeCloseTo(0.1, 8);
    }
  });
});
