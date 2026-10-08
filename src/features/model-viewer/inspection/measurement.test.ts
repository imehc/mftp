import { expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, PerspectiveCamera, Vector3 } from "three";
import { ModelCollection } from "../runtime/collection";
import { ModelMeasurement } from "./measurement";

it("测量变换后的源空间点，开始新的点对并释放标记", () => {
  const scene = new Group();
  const mesh = new Mesh(new BoxGeometry());
  mesh.position.set(40, 20, 10);
  scene.add(mesh);
  const entry = new ModelCollection(vi.fn()).prepare("test", {
    scene,
    name: "test",
    format: "GLB",
    size: 0,
    animations: [],
    hasGeometry: true,
    dispose() {},
  });
  entry.layer.position.set(5, 8, 4);
  entry.layer.rotation.y = 0.4;
  entry.layer.updateWorldMatrix(true, true);
  const canvas = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;
  const changed = vi.fn();
  const measurement = new ModelMeasurement(
    canvas,
    new PerspectiveCamera(),
    () => entry,
    changed,
  );
  const toWorld = (p: Vector3) => p.applyMatrix4(scene.parent!.matrixWorld);
  measurement.add(entry, toWorld(new Vector3(40, 20, 10)));
  measurement.add(entry, toWorld(new Vector3(43, 24, 10)));
  expect(changed.mock.lastCall![0]).toBe(2);
  expect(changed.mock.lastCall![1]).toBeCloseTo(5);
  measurement.add(entry, toWorld(new Vector3(40, 20, 10)));
  expect(changed.mock.lastCall).toEqual([1, null]);
  measurement.dispose();
  expect(scene.parent!.children).toEqual([scene]);
  expect(canvas.removeEventListener).toHaveBeenCalledTimes(3);
});
