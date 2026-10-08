import { afterEach, expect, it, vi } from "vitest";
import { IpcError } from "~/lib/errors";
import { browserSource } from "../sources/browser";
import { ModelResources } from "../runtime/resources";
import { readFbxImages } from "./fbx-images";

afterEach(() => vi.unstubAllGlobals());

const source = () => browserSource([new File(["test"], "model.fbx")]);

const image = (path: string) => ({ uuid: path, path, type: "image/png" });

it("按完整路径列出缺失贴图，补选前不开始图片解码", async () => {
  const decode = vi.fn();
  vi.stubGlobal("createImageBitmap", decode);
  await expect(
    readFbxImages(
      [image("a/map.png"), image("b/map.png")],
      source(),
      new AbortController().signal,
      vi.fn(),
      vi.fn(),
      8192,
    ),
  ).rejects.toMatchObject({ paths: ["a/map.png", "b/map.png"] });
  expect(decode).not.toHaveBeenCalled();
});

it("明确补选后解码并复用同路径贴图，释放时关闭位图", async () => {
  class Bitmap {
    width = 2;
    height = 2;
    close = vi.fn();
  }

  vi.stubGlobal("ImageBitmap", Bitmap);
  const bitmap = new Bitmap();
  const decode = vi.fn().mockResolvedValue(bitmap);
  vi.stubGlobal("createImageBitmap", decode);
  const input = source();
  await input.attach("a/map.png", new File(["pixels"], "other.png"));
  const resources = new ModelResources();
  const result = await readFbxImages(
    [image("a/map.png"), { ...image("a/map.png"), uuid: "second" }],
    input,
    new AbortController().signal,
    vi.fn(),
    (v) => resources.track(v),
    8192,
  );
  expect(result["a/map.png"].data).toBe(result.second.data);
  expect(decode).toHaveBeenCalledOnce();
  resources.dispose();
  resources.dispose();
  expect(bitmap.close).toHaveBeenCalledOnce();
});

it("取消等待在途图片解码实际完成，然后回收晚到的位图", async () => {
  class Bitmap {
    width = 1;
    height = 1;
    close = vi.fn();
  }

  vi.stubGlobal("ImageBitmap", Bitmap);
  let finish!: (bitmap: Bitmap) => void;
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const abort = new AbortController(),
    resources = new ModelResources(),
    bitmap = new Bitmap();
  const task = readFbxImages(
    [{ uuid: "one", blob: new Blob(["image"]), type: "image/png" }],
    source(),
    abort.signal,
    vi.fn(),
    (v) => resources.track(v),
    8192,
  );
  await vi.waitFor(() => expect(finish).toBeDefined());
  const done = vi.fn();
  void task.then(done, done);
  abort.abort();
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  finish(bitmap);
  await expect(task).rejects.toMatchObject({ name: "AbortError" });
  resources.dispose();
  expect(bitmap.close).toHaveBeenCalledOnce();
});

it("资源查询失败保持原始结构化错误，不当作缺少贴图", async () => {
  const input = source();
  const error = new IpcError({
    kind: "external",
    code: "io:permission_denied",
    message: "Permission denied",
    args: {},
  });
  input.sizeOf = async () => {
    throw error;
  };
  await expect(
    readFbxImages(
      [image("map.png")],
      input,
      new AbortController().signal,
      vi.fn(),
      vi.fn(),
      8192,
    ),
  ).rejects.toBe(error);
});
