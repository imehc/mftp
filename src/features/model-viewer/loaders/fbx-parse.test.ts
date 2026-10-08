import { Box3, Mesh, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import { fbxFixture } from "./fbx-fixture.test-utils";
import { parseFbx } from "./fbx-parse";
import { unpackFbx } from "./fbx-transfer";

it("在没有 DOM 的环境解析 ASCII，并保留可转移的几何与米制尺寸", async () => {
  const { value, buffers } = parseFbx(fbxFixture());
  const sent = structuredClone(value, { transfer: buffers });
  expect(buffers[0].byteLength).toBe(0);
  const scene = await unpackFbx(
    sent,
    {},
    new AbortController().signal,
    vi.fn(),
  );
  const size = new Box3().setFromObject(scene).getSize(new Vector3());
  expect(size.toArray()).toEqual([1, 1, 0]);
  let meshes = 0;
  scene.traverse((node) => {
    if (node instanceof Mesh) meshes++;
  });
  expect(meshes).toBe(1);
});

it.each([
  { label: "米制 Y-up", unit: 100, upAxis: 1, expected: [100, 100, 0] },
  { label: "厘米 Z-up", unit: 1, upAxis: 2, expected: [1, 0, 1] },
])(
  "$label 场景移交后保持米制尺寸及 Y-up 方向",
  async ({ unit, upAxis, expected }) => {
    const { value } = parseFbx(fbxFixture({ unit, upAxis }));
    const scene = await unpackFbx(
      value,
      {},
      new AbortController().signal,
      vi.fn(),
    );
    const bounds = new Box3().setFromObject(scene);
    const size = bounds.getSize(new Vector3()).toArray();
    expected.forEach((component, index) =>
      expect(size[index]).toBeCloseTo(component),
    );
    if (upAxis === 2) expect(bounds.min.z).toBeCloseTo(-1);
  },
);

it("保留 Windows 相对贴图目录，不按文件名截断，也不读取网络", () => {
  const result = parseFbx(fbxFixture({ path: "textures\\paint.png" }));
  expect(result.value.images).toMatchObject([
    { path: "textures/paint.png", type: "image/png" },
  ]);
});

it.each([
  "../paint.png",
  "C:\\private\\paint.png",
  "https://example.org/paint.png",
  "/paint.png",
])("拒绝未经授权的原始贴图路径 %s", (path) => {
  expect(() => parseFbx(fbxFixture({ path }))).toThrow(
    expect.objectContaining({ code: "model:unsafe" }),
  );
});

it("拒绝非法单位和无法解码的贴图格式", () => {
  expect(() => parseFbx(fbxFixture({ unit: 0 }))).toThrow(
    expect.objectContaining({ code: "model:fbx_unit" }),
  );
  expect(() => parseFbx(fbxFixture({ path: "paint.tif" }))).toThrow(
    expect.objectContaining({ code: "model:fbx_texture" }),
  );
});
