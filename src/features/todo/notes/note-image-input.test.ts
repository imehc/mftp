// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import {
  validateNoteImageDimensions,
  validateNoteImageInput,
} from "./note-image-input";

function pngHeader(width: number, height: number) {
  const header = new Uint8Array(24);
  header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(header.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return header;
}

function source(header: Uint8Array, size = 19_246_377) {
  const cancel = vi.fn();
  const fullRead = vi.fn(() => {
    throw new Error("不应读取完整图片");
  });
  const file = new File([], "large.png", { type: "image/png" });
  const read = vi.fn(
    () =>
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            controller.enqueue(header);
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
  );
  Object.defineProperties(file, {
    size: { value: size },
    arrayBuffer: { value: fullRead },
    stream: { value: read },
  });
  return { file, cancel, fullRead, read };
}

describe("备注图片头预检", () => {
  it("4096 方形图片超出像素上限，读取文件头后立即拒绝并取消流", async () => {
    const { file, cancel, fullRead } = source(pngHeader(4096, 4096));
    await expect(validateNoteImageInput(file)).rejects.toMatchObject({
      payload: { code: "todo:note_image_pixels" },
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fullRead).not.toHaveBeenCalled();
  });

  it("合法图片只读取尺寸，保留后端像素解码与完整性校验", async () => {
    const { file, cancel, fullRead } = source(pngHeader(4000, 3000));
    await expect(validateNoteImageInput(file)).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fullRead).not.toHaveBeenCalled();
  });

  it("单边超限和像素超限使用对应的结构化提示", async () => {
    await expect(async () =>
      validateNoteImageDimensions(8193, 1),
    ).rejects.toMatchObject({
      payload: { code: "todo:note_image_dimensions" },
    });
    await expect(async () =>
      validateNoteImageDimensions(4000, 3001),
    ).rejects.toMatchObject({
      payload: { code: "todo:note_image_pixels" },
    });
    await expect(async () =>
      validateNoteImageDimensions(0, 1),
    ).rejects.toMatchObject({
      payload: { code: "todo:note_image_invalid" },
    });
  });

  it("文件大小超限不读取图片流", async () => {
    const { file, read } = source(pngHeader(10, 10), 20_000_001);
    await expect(validateNoteImageInput(file)).rejects.toMatchObject({
      payload: { code: "todo:note_image_limit" },
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("损坏文件不能通过预检", async () => {
    await expect(
      validateNoteImageInput(new File(["broken"], "bad.png")),
    ).rejects.toMatchObject({
      payload: { code: "todo:note_image_invalid" },
    });
  });
});
