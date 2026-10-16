// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoadedNoteImage } from "./note-image-cache";
import {
  canCopyNoteImage,
  copyNoteImage,
  readNoteClipboardImage,
} from "./note-image-clipboard";

const native = vi.hoisted(() => ({
  available: vi.fn(),
  mobile: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: native.available }));
vi.mock("@tauri-apps/api/image", () => ({ Image: { new: native.create } }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readImage: native.read,
  writeImage: native.write,
}));
vi.mock("~/lib/platform", () => ({ isMobilePlatform: native.mobile }));

let canvas: HTMLCanvasElement;
let input: {
  size: ReturnType<typeof vi.fn>;
  rgba: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};
let output: { close: ReturnType<typeof vi.fn> };
let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
let context: {
  putImageData: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
};
let writeWeb: ReturnType<typeof vi.fn>;
let getContext: ReturnType<typeof vi.fn>;
let value: LoadedNoteImage;

beforeEach(() => {
  vi.resetAllMocks();
  native.available.mockReturnValue(true);
  native.mobile.mockReturnValue(false);
  canvas = document.createElement("canvas");
  context = {
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16) })),
  };
  getContext = vi.fn(() => context);
  Object.defineProperty(canvas, "getContext", { value: getContext });
  vi.spyOn(canvas, "toBlob").mockImplementation((callback) =>
    callback(new Blob(["png"], { type: "image/png" })),
  );
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag, options) =>
    tag === "canvas" ? canvas : createElement(tag, options),
  );
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  input = {
    size: vi.fn(async () => ({ width: 2, height: 2 })),
    rgba: vi.fn(async () => new Uint8Array(16)),
    close: vi.fn(async () => {}),
  };
  output = { close: vi.fn(async () => {}) };
  bitmap = { width: 2, height: 2, close: vi.fn() };
  native.read.mockResolvedValue(input);
  native.create.mockResolvedValue(output);
  native.write.mockResolvedValue(undefined);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap),
  );
  writeWeb = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { write: writeWeb } });
  vi.stubGlobal(
    "ClipboardItem",
    class {
      constructor(public items: Record<string, Promise<Blob>>) {}
    },
  );
  value = {
    image: {
      id: "image",
      mimeType: "image/png",
      width: 2,
      height: 2,
      byteLength: 3,
    },
    blob: new Blob(["png"], { type: "image/png" }),
    url: "blob:isolated",
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("待办图片剪贴板边界", () => {
  it("浏览器不调用原生读取，浏览器复制仅写入一次", async () => {
    native.available.mockReturnValue(false);
    expect(await readNoteClipboardImage()).toBeNull();
    await copyNoteImage(value);
    expect(native.read).not.toHaveBeenCalled();
    expect(native.write).not.toHaveBeenCalled();
    expect(writeWeb).toHaveBeenCalledTimes(1);
  });

  it("移动端直接使用浏览器能力，不尝试不支持的原生图片写入", async () => {
    native.mobile.mockReturnValue(true);
    expect(await readNoteClipboardImage()).toBeNull();
    await copyNoteImage(value);
    expect(native.read).not.toHaveBeenCalled();
    expect(native.write).not.toHaveBeenCalled();
    expect(writeWeb).toHaveBeenCalledTimes(1);
  });

  it("移动端没有浏览器图片写入能力时不宣称支持复制", () => {
    native.mobile.mockReturnValue(true);
    vi.stubGlobal("ClipboardItem", undefined);
    expect(canCopyNoteImage()).toBe(false);
  });

  it("原生读取成功后释放资源与画布", async () => {
    const file = await readNoteClipboardImage();
    expect(file?.type).toBe("image/png");
    expect(input.close).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("超出解码预算时不传输 RGBA，仍释放原生资源", async () => {
    input.size.mockResolvedValue({ width: 4000, height: 3001 });
    await expect(readNoteClipboardImage()).rejects.toMatchObject({
      payload: { code: "todo:note_image_pixels" },
    });
    expect(input.rgba).not.toHaveBeenCalled();
    expect(input.close).toHaveBeenCalledTimes(1);
  });

  it("拒绝尺寸与 RGBA 不一致的图片", async () => {
    input.rgba.mockResolvedValue(new Uint8Array(4));
    await expect(readNoteClipboardImage()).rejects.toMatchObject({
      payload: { code: "todo:note_image_unsupported" },
    });
    expect(context.putImageData).not.toHaveBeenCalled();
    expect(input.close).toHaveBeenCalledTimes(1);
  });

  it("剪贴板读取失败不能被当作没有图片，保留结构化错误", async () => {
    const error = {
      kind: "external",
      code: "clipboard:test",
      args: {},
      message: "failed",
    };
    native.read.mockRejectedValue(error);
    await expect(readNoteClipboardImage()).rejects.toMatchObject({
      payload: error,
    });
    expect(native.read).toHaveBeenCalledTimes(1);
  });

  it("PNG 编码失败时释放画布与原生图片", async () => {
    vi.mocked(canvas.toBlob).mockImplementation((callback) => callback(null));
    await expect(readNoteClipboardImage()).rejects.toBeDefined();
    expect(input.close).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("编码异常时保留结构化错误并清空画布", async () => {
    const error = {
      kind: "external",
      code: "clipboard:test",
      args: {},
      message: "failed",
    };
    context.putImageData.mockImplementation(() => {
      throw error;
    });
    await expect(readNoteClipboardImage()).rejects.toMatchObject({
      payload: error,
    });
    expect(input.close).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("原生写入成功后释放图片且不回退重复写入", async () => {
    await copyNoteImage(value);
    expect(native.write).toHaveBeenCalledTimes(1);
    expect(writeWeb).not.toHaveBeenCalled();
    expect(output.close).toHaveBeenCalledTimes(1);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(0);
  });

  it("原生写入失败不自动重放，保留原始错误并释放资源", async () => {
    const error = {
      kind: "external",
      code: "clipboard:test",
      args: {},
      message: "failed",
    };
    native.write.mockRejectedValue(error);
    await expect(copyNoteImage(value)).rejects.toBe(error);
    expect(native.write).toHaveBeenCalledTimes(1);
    expect(writeWeb).not.toHaveBeenCalled();
    expect(output.close).toHaveBeenCalledTimes(1);
  });

  it("获取画布上下文失败也释放位图与画布", async () => {
    getContext.mockReturnValue(null);
    await expect(copyNoteImage(value)).rejects.toThrow("Canvas");
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(native.write).not.toHaveBeenCalled();
    expect(writeWeb).not.toHaveBeenCalled();
  });

  it("创建原生图片失败也释放位图和画布，不进行剪贴板写入", async () => {
    const error = new Error("image creation failed");
    native.create.mockRejectedValue(error);
    await expect(copyNoteImage(value)).rejects.toBe(error);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(native.write).not.toHaveBeenCalled();
    expect(writeWeb).not.toHaveBeenCalled();
  });
});
