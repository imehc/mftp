import { expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { ModelCollection, layoutPositions } from "./collection";
import { ModelResources } from "./resources";
import { memoryInventory, memoryTotals } from "./memory";

function model() {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
  const resources = new ModelResources();
  resources.track(scene);
  return {
    scene,
    name: "box.glb",
    format: "GLB",
    size: 100,
    animations: [],
    hasGeometry: true,
    dispose: () => resources.dispose(),
  };
}
it("布局具有确定性、居中且保持间距", () => {
  for (const layout of ["row", "grid", "ring"] as const) {
    const positions = layoutPositions(7, layout);
    expect(positions).toEqual(layoutPositions(7, layout));
    for (let i = 0; i < positions.length; i++)
      for (let j = i + 1; j < positions.length; j++)
        expect(positions[i].distanceTo(positions[j])).toBeGreaterThanOrEqual(
          2.99,
        );
  }
  expect(layoutPositions(1, "ring")[0].toArray()).toEqual([0, 0, 0]);
});
it("追加操作保留位置，重置操作恢复上次布局基线", () => {
  const collection = new ModelCollection(vi.fn());
  collection.add(collection.prepare("a", model()));
  collection.move("a", [4, 1, 2]);
  collection.add(collection.prepare("b", model()));
  expect(collection.entries.get("a")!.layer.position.toArray()).toEqual([
    4, 1, 2,
  ]);
  collection.arrange("row");
  collection.move("a", [8, 3, 4]);
  collection.reset("a");
  expect(collection.entries.get("a")!.layer.position.toArray()).toEqual([
    -1.5, 0, 0,
  ]);
  collection.move("a", [NaN, 0, 0]);
  expect(collection.entries.get("a")!.layer.position.x).toBe(-1.5);
  collection.remove("a");
  expect(collection.entries.has("b")).toBe(true);
  collection.dispose();
});
it("经过 20 轮加载和删除后模型对象及跟踪分配回到基线", () => {
  const collection = new ModelCollection(vi.fn());
  const peaks: number[] = [];
  for (let i = 0; i < 20; i++) {
    const handle = model();
    const geometry = (handle.scene.children[0] as Mesh).geometry;
    const release = vi.fn();
    geometry.addEventListener("dispose", release);
    collection.add(collection.prepare(String(i), handle));
    peaks.push(
      memoryTotals(
        [...collection.entries.values()].map((e) => memoryInventory(e.handle)),
      ).known,
    );
    collection.remove(String(i));
    expect(release).toHaveBeenCalledOnce();
    expect(collection.root.children).toHaveLength(0);
    expect(
      memoryTotals(
        [...collection.entries.values()].map((e) => memoryInventory(e.handle)),
      ).known,
    ).toBe(0);
  }
  expect(new Set(peaks).size).toBe(1);
});
