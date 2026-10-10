import { describe, expect, it } from "vitest";

import { fbm, hash2, valueNoise } from "./noise";

describe("游戏纹理确定性噪声", () => {
  // 从提取前的游戏实现采集，防止调整常量或运算顺序后静默改变纹理。
  it.each([
    [0, 0, 0, 0],
    [1, 2, 0.8830856902059168, 0.5856575594350163],
    [-3, -7, 0.12737385486252606, 0.2984908421390823],
    [0.25, 0.75, 0.6468702832341933, 0.6235108366894825],
    [-1.25, 3.5, 0.5974421422361047, 0.5392733205184673],
    [831.999, 927.001, 0.09449439887907318, 0.2448991030440944],
  ])("坐标 (%s, %s) 保持原纹理采样结果", (x, y, noise, layered) => {
    expect(valueNoise(x, y)).toBe(noise);
    expect(fbm(x, y, 3)).toBe(layered);
  });

  it("整数格点保留哈希值且跨格点连续", () => {
    for (const [x, y] of [
      [1, 2],
      [-3, -7],
    ]) {
      const center = hash2(x, y);
      expect(valueNoise(x, y)).toBe(center);
      expect(valueNoise(x - 1e-6, y + 1e-6)).toBeCloseTo(center, 10);
      expect(valueNoise(x + 1e-6, y - 1e-6)).toBeCloseTo(center, 10);
    }
  });
});
