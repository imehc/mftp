import { describe, expect, it } from "vitest";

import { ballSurfaceAtUV, buildBallPolishTexture } from "./ball-surface";

describe("球面抛光纹理", () => {
  it("经度接缝和极点连续，旋转时不会露出接缝或极点条纹", () => {
    for (let step = 0; step <= 32; step++) {
      const fraction = step / 32;
      expect(ballSurfaceAtUV(0, fraction)).toBeCloseTo(
        ballSurfaceAtUV(1, fraction),
        10,
      );
      expect(ballSurfaceAtUV(fraction, 0)).toBeCloseTo(
        ballSurfaceAtUV(0, 0),
        10,
      );
      expect(ballSurfaceAtUV(fraction, 1)).toBeCloseTo(
        ballSurfaceAtUV(0, 1),
        10,
      );
    }
  });

  it("球面具有有限的非均匀抛光变化，同时保持平滑过滤", () => {
    const texture = buildBallPolishTexture();
    const pixels = texture.image.data!;
    const values = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4) {
      const value = pixels[i];
      expect(value).toBeGreaterThanOrEqual(65);
      expect(value).toBeLessThanOrEqual(255);
      values.add(value);
    }
    expect(values.size).toBeGreaterThan(50);
    expect(texture.generateMipmaps).toBe(true);
    texture.dispose();
  });
});
