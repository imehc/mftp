import { expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { browserSource } from "../sources/browser";
import { MissingResources } from "../domain/errors";
import { prepareGltf } from "./prepare";

i18n.loadAndActivate({ locale: "zh-CN", messages: {} });

const signal = () => new AbortController().signal;

const modelFile = (extra: object) =>
  new File(
    [JSON.stringify({ asset: { version: "2.0" }, ...extra })],
    "model.gltf",
  );

it("在任何解码前列出所有缺失依赖，且绝不猜测基础名称", async () => {
  const source = browserSource([
    modelFile({
      buffers: [{ uri: "data.bin", byteLength: 4 }],
      images: [{ uri: "a/map.png" }, { uri: "b/map.png" }],
    }),
    new File(["image"], "map.png"),
  ]);
  await expect(prepareGltf(source, signal(), vi.fn())).rejects.toEqual(
    new MissingResources(["data.bin", "a/map.png", "b/map.png"]),
  );
});

it("支持显式路径映射，并在释放时撤销所有 URL", async () => {
  const source = browserSource([
    modelFile({ buffers: [{ uri: "a/data%20file.bin", byteLength: 4 }] }),
  ]);
  await source.attach(
    "a/data file.bin",
    new File([new Uint8Array([1, 2, 3, 4])], "anything.bin"),
  );
  const result = await prepareGltf(source, signal(), vi.fn());
  expect([...result.archive.keys()]).toEqual(["", "a/data file.bin"]);
  expect(result.archive.get("a/data file.bin")).toBe(
    result.validationSource.resources.get("a/data%20file.bin"),
  );
  const uri = result.json.buffers![0].uri!;
  expect(new Uint8Array(await (await fetch(uri)).arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3, 4]),
  );
  result.dispose();
  result.dispose();
  await expect(fetch(uri)).rejects.toThrow();
});

it("保留原始的结构化读取失败", async () => {
  const source = browserSource([
    modelFile({ buffers: [{ uri: "a.bin", byteLength: 4 }] }),
  ]);
  const denied = {
    kind: "external",
    code: "io:permission_denied",
    message: "Permission denied",
    args: {},
  };
  source.sizeOf = async () => {
    throw denied;
  };
  await expect(prepareGltf(source, signal(), vi.fn())).rejects.toBe(denied);
});

it("在读取前取消，并拒绝网络 URI", async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(
    prepareGltf(browserSource([modelFile({})]), abort.signal, vi.fn()),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    prepareGltf(
      browserSource([
        modelFile({ images: [{ uri: "https://example.org/image.png" }] }),
      ]),
      signal(),
      vi.fn(),
    ),
  ).rejects.toMatchObject({ payload: { code: "model:unsafe" } });
});

it("解码嵌入数据，并将图像 bufferView 转为自有资源", async () => {
  const source = browserSource([
    modelFile({
      buffers: [
        { uri: "data:application/octet-stream;base64,AQIDBA==", byteLength: 4 },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 1, byteLength: 2 }],
      images: [{ bufferView: 0, mimeType: "image/png" }],
    }),
  ]);
  const result = await prepareGltf(source, signal(), vi.fn());
  const image = result.json.images![0];
  expect(image.bufferView).toBeUndefined();
  expect(new Uint8Array(await (await fetch(image.uri!)).arrayBuffer())).toEqual(
    new Uint8Array([2, 3]),
  );
  result.dispose();
});

it("后续数据块无效时回滚 URL", async () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const source = browserSource([
    modelFile({
      buffers: [
        { uri: "data:;base64,AQIDBA==", byteLength: 4 },
        { byteLength: 10 },
      ],
    }),
  ]);
  await expect(prepareGltf(source, signal(), vi.fn())).rejects.toThrow();
  expect(revoke).toHaveBeenCalledTimes(1);
  revoke.mockRestore();
});
