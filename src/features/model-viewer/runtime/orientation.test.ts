import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { axisDirections, orientCamera, type ViewAxis } from "./orientation";

describe("坐标轴视图", () => {
  it("在六个方向上保留轨道目标和距离", () => {
    const camera = new PerspectiveCamera();
    const target = new Vector3(5, -2, 7);
    camera.position.copy(target).add(new Vector3(3, 2, 4));
    const distance = camera.position.distanceTo(target);
    for (const axis of Object.keys(axisDirections) as ViewAxis[]) {
      orientCamera(camera, target, axis);
      expect(camera.position.distanceTo(target)).toBeCloseTo(distance);
      const offset = camera.position.clone().sub(target).normalize();
      expect(
        offset.distanceTo(new Vector3(...axisDirections[axis])),
      ).toBeLessThan(0.00001);
      expect(
        camera.getWorldDirection(new Vector3()).distanceTo(offset.negate()),
      ).toBeLessThan(0.00001);
      expect(camera.quaternion.toArray().every(Number.isFinite)).toBe(true);
    }
    expect(target.toArray()).toEqual([5, -2, 7]);
  });
});
