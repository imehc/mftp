import { i18n } from "@lingui/core";
import { afterEach, expect, it, vi } from "vitest";

import { capturePng, captureSize } from "./capture";

i18n.load("en", {});
i18n.activate("en");

afterEach(() => vi.unstubAllGlobals());

it("保持比例并限制边长和总像素，不放大小画布", () => {
  expect(captureSize(320, 180)).toEqual({ width: 320, height: 180 });
  expect(captureSize(10000, 1000)).toEqual({ width: 4096, height: 409 });
  const size = captureSize(6000, 6000);
  expect(size.width * size.height).toBeLessThanOrEqual(8_000_000);
  expect(size.width).toBe(size.height);
  expect(() => captureSize(0, 100)).toThrow();
  expect(() => captureSize(Infinity, 100)).toThrow();
});

it("异步编码前同步复制像素，完成后释放临时画布", async () => {
  const draw = vi.fn();
  let finish!: BlobCallback;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: draw }),
    toBlob: (callback: BlobCallback) => {
      finish = callback;
    },
  };
  vi.stubGlobal("document", { createElement: () => canvas });
  const source = { width: 800, height: 600 } as HTMLCanvasElement;
  const pending = capturePng(source);
  expect(draw).toHaveBeenCalledWith(source, 0, 0, 800, 600);
  const blob = new Blob(["png"], { type: "image/png" });
  finish(blob);
  await expect(pending).resolves.toBe(blob);
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
});

it("编码失败返回结构化错误并释放画布", async () => {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: vi.fn() }),
    toBlob: (callback: BlobCallback) => callback(null),
  };
  vi.stubGlobal("document", { createElement: () => canvas });
  await expect(
    capturePng({ width: 10, height: 10 } as HTMLCanvasElement),
  ).rejects.toMatchObject({ payload: { code: "model:capture" } });
  expect(canvas.width).toBe(0);
});
