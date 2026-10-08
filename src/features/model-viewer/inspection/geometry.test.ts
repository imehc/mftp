import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { expect, it, vi } from "vitest";

import { ModelCollection } from "../runtime/collection";
import { sampleGeometry, sourcePoint } from "./geometry";
import { analyzeTopology } from "./topology";

export function entryFor(mesh: Mesh) {
  const scene = new Group();
  scene.add(mesh);
  const models = new ModelCollection(vi.fn());
  return models.prepare("test", {
    scene,
    name: "fixture.glb",
    format: "GLB",
    size: 0,
    animations: [],
    hasGeometry: true,
    dispose() {},
  });
}

it("在节点变换后测量源文件米制尺寸，并忽略显示位置和归一化", async () => {
  const mesh = new Mesh(new BoxGeometry(2, 4, 6));
  mesh.position.set(20, 30, 40);
  mesh.scale.set(2, 3, 4);
  mesh.rotation.z = Math.PI / 2;
  const entry = entryFor(mesh);
  entry.layer.position.set(7, 8, 9);
  entry.layer.rotation.y = 0.8;
  const { bounds } = await sampleGeometry(entry, new AbortController().signal);
  expect(
    bounds
      .getSize(new Vector3())
      .toArray()
      .map((n) => Math.round(n)),
  ).toEqual([12, 4, 24]);
  const source = new Vector3(20, 30, 40);
  const world = source
    .clone()
    .applyMatrix4(entry.handle.scene.parent!.matrixWorld);
  expect(sourcePoint(entry, world).distanceTo(source)).toBeLessThan(1e-10);
});

it("采样每个实例的变换，并在反射下保留渲染方向", async () => {
  const mesh = new InstancedMesh(
    new BoxGeometry(2, 2, 2),
    new MeshStandardMaterial(),
    2,
  );
  mesh.setMatrixAt(0, new Matrix4().makeScale(-1, 1, 1));
  mesh.setMatrixAt(1, new Matrix4().makeTranslation(8, 0, 0));
  const result = await sampleGeometry(
    entryFor(mesh),
    new AbortController().signal,
  );
  expect(result.samples).toHaveLength(2);
  expect(result.bounds.getSize(new Vector3()).x).toBe(10);
  for (const sample of result.samples)
    expect(analyzeTopology(sample, 1e-5)).toMatchObject({
      openEdges: 0,
      inwardShells: 0,
      opposedNormals: 0,
    });
});

it("采样当前变形位置，不比较未变形法线", async () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute(
    "normal",
    new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
  );
  geometry.morphAttributes.position = [
    new Float32BufferAttribute([0, 0, 2, 0, 0, 2, 0, 0, 2], 3),
  ];
  geometry.morphTargetsRelative = true;
  const mesh = new Mesh(geometry);
  mesh.morphTargetInfluences![0] = 0.5;
  const { samples } = await sampleGeometry(
    entryFor(mesh),
    new AbortController().signal,
  );
  expect(samples[0].positions[2]).toBe(1);
  expect(samples[0].normals).toBeNull();
});

it("拒绝过度的实例展开并遵循取消操作", async () => {
  const signal = new AbortController();
  signal.abort();
  await expect(
    sampleGeometry(entryFor(new Mesh(new BoxGeometry())), signal.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  const many = new InstancedMesh(
    new BoxGeometry(),
    new MeshStandardMaterial(),
    1001,
  );
  await expect(
    sampleGeometry(entryFor(many), new AbortController().signal),
  ).rejects.toBeDefined();
});
