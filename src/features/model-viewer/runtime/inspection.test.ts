import { describe, expect, it } from "vitest";
import {
  AnimationClip,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Points,
  Texture,
} from "three";
import { inspectModel } from "./inspection";
import { visibleSceneNodes } from "../domain/inspection";

function inspect(scene: Group) {
  return inspectModel({
    scene,
    name: "fixture",
    format: "glTF",
    size: 0,
    hasGeometry: true,
    animations: [new AnimationClip("a", 1, [])],
    dispose() {},
  }).snapshot;
}
function triangle() {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  return geometry;
}
describe("模型资源检查", () => {
  it("对资源去重但统计实例副本，并忽略三角形的线和点", () => {
    const scene = new Group();
    const texture = new Texture({ width: 64, height: 32 });
    const material = new MeshStandardMaterial({
      map: texture,
      roughnessMap: texture,
    });
    const geometry = triangle();
    scene.add(
      new LineSegments(geometry, material),
      new Mesh(geometry, material),
      new InstancedMesh(geometry, material, 4),
      new Points(triangle(), material),
    );
    const result = inspect(scene);
    expect(result.counts).toEqual({
      vertices: 6,
      triangles: 1,
      geometries: 2,
      instances: 7,
      materials: 1,
      textures: 1,
      animations: 1,
    });
    expect(result.textures[0]).toMatchObject({
      width: 64,
      height: 32,
      slots: ["map", "roughnessMap"],
    });
    expect(result.materials[0].textures).toHaveLength(2);
    expect(result.nodes[scene.children[1].uuid].materials).toEqual([
      material.uuid,
    ]);
  });
  it("索引缓冲区只统计一次，并将不可用位置报告为未知而不是零", () => {
    const scene = new Group();
    const geometry = triangle();
    geometry.setIndex([0, 1, 2, 2, 1, 0]);
    geometry.setDrawRange(0, 3);
    scene.add(new Mesh(geometry));
    expect(inspect(scene).counts).toMatchObject({ vertices: 3, triangles: 2 });
    scene.add(new Mesh(new BufferGeometry()));
    expect(inspect(scene).counts).toMatchObject({
      vertices: null,
      triangles: null,
    });
    expect(inspect(new Group()).counts).toMatchObject({
      vertices: 0,
      triangles: 0,
      textures: 0,
    });
  });
  it("仅按源顺序展开已展开节点，并处理大型场景", () => {
    const scene = new Group();
    const branch = new Group();
    scene.add(branch);
    for (let i = 0; i < 12000; i++) {
      const node = new Group();
      node.name = String(i);
      branch.add(node);
    }
    const result = inspect(scene);
    expect(visibleSceneNodes(result, new Set())).toHaveLength(1);
    expect(visibleSceneNodes(result, new Set([scene.uuid]))).toHaveLength(2);
    const rows = visibleSceneNodes(result, new Set([scene.uuid, branch.uuid]));
    expect(rows).toHaveLength(12002);
    expect(rows[12001]).toMatchObject({
      depth: 2,
      position: 12000,
      siblings: 12000,
      node: { name: "11999" },
    });
  });
});
