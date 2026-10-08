import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Sphere,
} from "three";
import { expect, it } from "vitest";

import { fitCamera, frameModel } from "./framing";

it.each([1e-9, 1, 1e9])(
  "frames scale %s without altering original model transforms",
  (scale) => {
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    mesh.position.set(100 * scale, -20 * scale, 30 * scale);
    mesh.scale.setScalar(scale);
    const original = mesh.position.clone();
    const framed = frameModel(mesh);
    framed.updateMatrixWorld(true);
    const bounds = new Box3()
      .setFromObject(framed)
      .getBoundingSphere(new Sphere());
    expect(bounds.radius).toBeCloseTo(1, 4);
    expect(bounds.center.length()).toBeLessThan(1e-4);
    expect(mesh.position.equals(original)).toBe(true);
    mesh.geometry.dispose();
    (mesh.material as MeshBasicMaterial).dispose();
  },
);

it("处理空模型和竖向适配，并保持相机值有限", () => {
  expect(frameModel(new Group()).children).toHaveLength(1);
  for (const aspect of [0.3, 1, 4]) {
    const camera = new PerspectiveCamera(45, aspect);
    fitCamera(camera);
    expect(camera.position.length()).toBeGreaterThan(1);
    expect(Number.isFinite(camera.position.length())).toBe(true);
  }
});
