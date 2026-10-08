import { expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import { flightDisplacement } from "./flight";

it("使用面向相机的方向，限制对角速度并遵循垂直输入", () => {
  const camera = new PerspectiveCamera();
  expect(flightDisplacement(camera, 0, 1, 0, 2).toArray()).toEqual([0, 0, -2]);
  expect(flightDisplacement(camera, 1, 1, 1, 2).length()).toBeCloseTo(2);
  camera.rotation.y = Math.PI / 2;
  expect(flightDisplacement(camera, 0, 1, 0, 1).x).toBeCloseTo(-1);
  expect(flightDisplacement(camera, 0, 0, 1, 2).y).toBe(2);
});
