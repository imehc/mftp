import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createRecordingEncoder } from "./recording-encoder";

const mock = vi.hoisted(() => ({
  canEncodeVideo: vi.fn(),
  add: vi.fn(),
  close: vi.fn(),
  cancel: vi.fn(),
  finalize: vi.fn(),
  start: vi.fn(),
  stream: null as WritableStream | null,
}));
vi.mock("mediabunny", () => ({
  canEncodeVideo: mock.canEncodeVideo,
  CanvasSource: class {
    add = mock.add;
    close = mock.close;
  },
  Mp4OutputFormat: class {},
  WebMOutputFormat: class {},
  StreamTarget: class {
    constructor(stream: WritableStream) {
      mock.stream = stream;
    }
  },
  Output: class {
    addVideoTrack() {}
    start = mock.start;
    finalize = mock.finalize;
    cancel = mock.cancel;
  },
}));
const draw = vi.fn();
const fill = vi.fn();
let canvas: { width: number; height: number; getContext: () => unknown };

beforeEach(() => {
  vi.resetAllMocks();
  mock.canEncodeVideo.mockResolvedValue(true);
  mock.add.mockResolvedValue(undefined);
  mock.start.mockResolvedValue(undefined);
  mock.cancel.mockResolvedValue(undefined);
  mock.finalize.mockImplementation(async () => {
    const writer = mock.stream!.getWriter();
    await writer.write({ data: new Uint8Array([1, 2, 3]), position: 0 });
    await writer.close();
  });
  canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: "", fillRect: fill, drawImage: draw }),
  };
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
});

afterEach(() => vi.unstubAllGlobals());

it("按能力选择容器，输出固定尺寸且窗口变化时等比留边", async () => {
  mock.canEncodeVideo.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const encoder = await createRecordingEncoder(640, 360);
  expect(encoder.extension).toBe("webm");
  const source = { width: 360, height: 640 } as HTMLCanvasElement;
  await encoder.add(source, 0);
  expect(fill).toHaveBeenCalledWith(0, 0, 640, 360);
  expect(draw).toHaveBeenCalledWith(source, 218.75, 0, 202.5, 360);
  await encoder.cancel();
  expect(canvas.width).toBe(0);
});

it("尾帧保持到停止时刻并释放画布，产物类型与容器匹配", async () => {
  const encoder = await createRecordingEncoder(640, 360);
  await encoder.add({ width: 640, height: 360 } as HTMLCanvasElement, 0);
  const blob = await encoder.finish(2);
  expect(mock.add).toHaveBeenLastCalledWith(2 - 1 / 30, 1 / 30);
  expect(mock.close).toHaveBeenCalledOnce();
  expect(blob.type).toBe("video/mp4");
  expect(blob.size).toBe(3);
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
});

it("编码不受支持时不创建画布或输出", async () => {
  mock.canEncodeVideo.mockResolvedValue(false);
  await expect(createRecordingEncoder(640, 360)).rejects.toMatchObject({
    payload: { code: "model:recording_unsupported" },
  });
  expect(document.createElement).not.toHaveBeenCalled();
  expect(mock.start).not.toHaveBeenCalled();
});

it("输出启动失败先等待资源释放再报告错误", async () => {
  const error = new Error("Output start failed");
  mock.start.mockRejectedValue(error);
  await expect(createRecordingEncoder(640, 360)).rejects.toBe(error);
  expect(mock.cancel).toHaveBeenCalledOnce();
  expect(canvas.width).toBe(0);
});
