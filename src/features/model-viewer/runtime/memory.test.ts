import {
  AnimationClip,
  BufferGeometry,
  CompressedTexture,
  DataTexture,
  Float32BufferAttribute,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  RGBA_S3TC_DXT5_Format,
  RGBAFormat,
  UnsignedByteType,
} from "three";
import { expect, it, vi } from "vitest";

import {
  MemoryHistory,
  memoryInventory,
  memoryTotals,
  textureBytes,
} from "./memory";

function model(scene: Group, animations: AnimationClip[] = []) {
  return {
    scene,
    animations,
    name: "test",
    format: "GLB",
    size: 1,
    hasGeometry: true,
    dispose() {},
  };
}

it("跨模型对交错数组、共享几何体和纹理去重", () => {
  const data = new InterleavedBuffer(new Float32Array(18), 6);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new InterleavedBufferAttribute(data, 3, 0));
  geometry.setAttribute("normal", new InterleavedBufferAttribute(data, 3, 3));
  const texture = new DataTexture(
    new Uint8Array(16),
    2,
    2,
    RGBAFormat,
    UnsignedByteType,
  );
  const material = new MeshBasicMaterial({ map: texture });
  const a = new Group(),
    b = new Group();
  a.add(new Mesh(geometry, material));
  b.add(new Mesh(geometry, material));
  const first = memoryInventory(model(a)),
    second = memoryInventory(model(b));
  expect(memoryTotals([first])).toMatchObject({ cpu: 88, gpu: 88, known: 176 });
  expect(memoryTotals([first, second])).toEqual(memoryTotals([first]));
});

it("统计精确的 mip 尺寸、压缩块和未知格式", () => {
  const texture = new DataTexture(new Uint8Array(60), 3, 5);
  texture.generateMipmaps = true;
  expect(textureBytes(texture)).toBe(72);
  const compressed = new CompressedTexture(
    [{ data: new Uint8Array(64), width: 5, height: 5 }],
    5,
    5,
    RGBA_S3TC_DXT5_Format,
  );
  expect(textureBytes(compressed)).toBe(64);
  texture.format = -99 as typeof texture.format;
  expect(textureBytes(texture)).toBeNull();
});

it("包含动画和变形 CPU 数组，但不假定知道 GPU 变形打包方式", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3));
  geometry.morphAttributes.position = [
    new Float32BufferAttribute([1, 0, 0], 3),
  ];
  const group = new Group();
  group.add(new Mesh(geometry, new MeshBasicMaterial()));
  const animation = new AnimationClip("move", 1, [
    new NumberKeyframeTrack(".position[x]", [0, 1], [0, 1]),
  ]);
  const inventory = memoryInventory(model(group, [animation]));
  expect(memoryTotals([inventory])).toMatchObject({
    cpu: 40,
    gpu: 12,
    unknown: 1,
  });
});

it("历史记录有界，采样量不会随帧率增长", () => {
  const memory = new MemoryHistory();
  for (let time = 0; time < 200000; time += 10) memory.sample(time);
  expect(memory.snapshot().history).toHaveLength(120);
  expect(memory.snapshot().history[0].time).toBe(80000);
  memory.pause(true);
  memory.sample(300000);
  expect(memory.snapshot().history.at(-1)!.time).toBe(199000);
  memory.pause(false);
  memory.sample(400000);
  expect(memory.snapshot().history.at(-1)!.time).toBe(400000);
  memory.dispose();
  expect(memory.snapshot().history).toHaveLength(0);
});

it("后台采样停止和恢复时不会填补隐藏时间", () => {
  vi.useFakeTimers();
  const documentState = { hidden: false };
  vi.stubGlobal("document", documentState);
  const memory = new MemoryHistory();
  try {
    memory.start();
    vi.advanceTimersByTime(1000);
    expect(memory.snapshot().history).toHaveLength(1);
    documentState.hidden = true;
    vi.advanceTimersByTime(10000);
    expect(memory.snapshot().history).toHaveLength(1);
    documentState.hidden = false;
    vi.advanceTimersByTime(1000);
    expect(memory.snapshot().history).toHaveLength(2);
    expect(
      memory.snapshot().history[1].time - memory.snapshot().history[0].time,
    ).toBe(11000);
  } finally {
    memory.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
