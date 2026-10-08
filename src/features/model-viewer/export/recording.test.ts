import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { downloadBlob } from "~/lib/files";

import { ViewerRecording } from "./recording";
import type { RecordingEncoder } from "./recording-encoder";

vi.mock("~/lib/files", async (original) => ({
  ...(await original<typeof import("~/lib/files")>()),
  downloadBlob: vi.fn(),
}));
const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
const blob = new Blob(["video"], { type: "video/mp4" });
let controllers: ViewerRecording[] = [];

function setup() {
  const encoder: RecordingEncoder = {
    extension: "mp4",
    width: 1280,
    height: 720,
    add: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn().mockResolvedValue(blob),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
  const create = vi.fn().mockResolvedValue(encoder);
  const invalidate = vi.fn();
  const controller = new ViewerRecording(invalidate, create);
  controllers.push(controller);
  return { controller, encoder, create, invalidate };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
});

afterEach(async () => {
  await Promise.all(controllers.map((controller) => controller.dispose()));
  controllers = [];
  vi.useRealTimers();
});

it("重复启动只创建一个编码器，静态场景也请求首帧", async () => {
  const { controller, create, invalidate } = setup();
  await Promise.all([
    controller.start(1280, 720, "demo.glb"),
    controller.start(1280, 720, "other.glb"),
  ]);
  expect(create).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledOnce();
  expect(controller.active).toBe(true);
});

it("像素在帧回调中同步交给编码器，慢编码期间不排队", async () => {
  const { controller, encoder } = setup();
  let finish!: () => void;
  vi.mocked(encoder.add).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await controller.start(1280, 720, "demo.glb");
  controller.frame(canvas, 1000);
  expect(encoder.add).toHaveBeenCalledWith(canvas, 0);
  controller.frame(canvas, 2000);
  expect(encoder.add).toHaveBeenCalledTimes(1);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  controller.frame(canvas, 3000);
  expect(encoder.add).toHaveBeenLastCalledWith(canvas, 2);
});

it("停止等待在途编码完成，重复停止只封装一次文件", async () => {
  const { controller, encoder } = setup();
  let finish!: () => void;
  vi.mocked(encoder.add).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await controller.start(1280, 720, "demo.glb");
  controller.frame(canvas, 1000);
  const pending = controller.stop();
  expect(controller.stop()).toBe(pending);
  expect(controller.snapshot().status).toBe("stopping");
  expect(encoder.finish).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(encoder.finish).toHaveBeenCalledOnce();
  expect(controller.snapshot()).toMatchObject({
    status: "ready",
    result: { blob },
  });
});

it("初始化期间切页等待编码器创建并取消，不恢复录制", async () => {
  const { controller, create, encoder, invalidate } = setup();
  let finish!: (value: RecordingEncoder) => void;
  create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const starting = controller.start(1280, 720, "demo.glb");
  await Promise.resolve();
  const closing = controller.dispose();
  expect(controller.snapshot().status).toBe("stopping");
  finish(encoder);
  await Promise.all([starting, closing]);
  expect(encoder.cancel).toHaveBeenCalledOnce();
  expect(invalidate).not.toHaveBeenCalled();
  expect(controller.snapshot().status).toBe("idle");
});

it("编码资源实际释放前保持停止状态", async () => {
  const { controller, encoder } = setup();
  let release!: () => void;
  vi.mocked(encoder.cancel).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await controller.start(1280, 720, "demo.glb");
  const closing = controller.dispose();
  await Promise.resolve();
  await Promise.resolve();
  expect(controller.snapshot().status).toBe("stopping");
  release();
  await closing;
  expect(controller.snapshot().status).toBe("idle");
});

it("时长到达上限后自动结束，生成文件前不打开保存对话框", async () => {
  const { controller, encoder } = setup();
  await controller.start(1280, 720, "demo.glb");
  controller.frame(canvas, 1000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(encoder.finish).toHaveBeenCalledOnce();
  expect(controller.snapshot().status).toBe("ready");
  expect(downloadBlob).not.toHaveBeenCalled();
});

it("丢失图形上下文时取消输出并保留结构化失败", async () => {
  const { controller, encoder } = setup();
  await controller.start(1280, 720, "demo.glb");
  controller.frame(canvas, 1000);
  await controller.interrupt();
  expect(encoder.cancel).toHaveBeenCalledOnce();
  expect(encoder.finish).not.toHaveBeenCalled();
  expect(controller.snapshot().error?.code).toBe("model:recording_failed");
});

it("编码失败释放资源，不封装损坏产物", async () => {
  const { controller, encoder } = setup();
  vi.mocked(encoder.add).mockRejectedValue(new Error("Encoder failed"));
  await controller.start(1280, 720, "demo.glb");
  controller.frame(canvas, 1000);
  await vi.advanceTimersByTimeAsync(0);
  expect(encoder.cancel).toHaveBeenCalledOnce();
  expect(controller.snapshot()).toMatchObject({
    status: "failed",
    result: null,
    error: { code: "model:recording_failed" },
  });
});

it("保存取消或失败保留产物，显式重试成功后才标记已保存", async () => {
  const { controller, create } = setup();
  await controller.start(1280, 720, "demo.glb");
  controller.frame(canvas, 1000);
  await controller.stop();
  await controller.start(1280, 720, "other.glb");
  expect(create).toHaveBeenCalledOnce();
  vi.mocked(downloadBlob)
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error("Write failed"))
    .mockResolvedValueOnce(5);
  await controller.save();
  expect(controller.snapshot()).toMatchObject({
    status: "ready",
    saved: false,
    result: { blob },
  });
  await controller.save();
  expect(controller.snapshot().error?.code).toBe("model:recording_save");
  expect(downloadBlob).toHaveBeenCalledTimes(2);
  await controller.save();
  expect(controller.snapshot()).toMatchObject({ saved: true, error: null });
  controller.discard();
  expect(controller.snapshot().result).toBeNull();
});

it("封装期间切页丢弃完成的文件，不显示过期结果", async () => {
  const { controller, encoder } = setup();
  let finish!: (value: Blob) => void;
  vi.mocked(encoder.finish).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await controller.start(1280, 720, "demo.glb");
  controller.frame(canvas, 1000);
  const pending = controller.stop();
  await vi.advanceTimersByTimeAsync(0);
  const closing = controller.dispose();
  finish(blob);
  await Promise.all([pending, closing]);
  expect(controller.snapshot().result).toBeNull();
  expect(controller.snapshot().status).toBe("idle");
});

it("慢编码的最后画面保留到用户停止时刻", async () => {
  const { controller, encoder } = setup();
  await controller.start(1280, 720, "demo.glb");
  controller.frame(canvas, performance.now());
  await vi.advanceTimersByTimeAsync(2200);
  await controller.stop();
  expect(encoder.finish).toHaveBeenCalledWith(2.2);
});

it("保存进行中切页保持任务占用直到实际写入结束", async () => {
  const { controller } = setup();
  await controller.start(1280, 720, "demo.glb");
  controller.frame(canvas, 0);
  await controller.stop();
  let finish!: (value: number) => void;
  vi.mocked(downloadBlob).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const saving = controller.save();
  expect(controller.save()).toBe(saving);
  const closing = controller.dispose();
  expect(closing).toBe(saving);
  expect(controller.snapshot().status).toBe("saving");
  expect(vi.mocked(downloadBlob).mock.calls[0][2]?.aborted).toBe(true);
  finish(5);
  await closing;
  expect(controller.snapshot()).toMatchObject({ status: "idle", result: null });
});

it("清理失败保留错误，不把失败释放标记为成功取消", async () => {
  const { controller, encoder } = setup();
  vi.mocked(encoder.cancel).mockRejectedValue(new Error("Cleanup failed"));
  await controller.start(1280, 720, "demo.glb");
  await controller.dispose();
  expect(controller.snapshot()).toMatchObject({
    status: "failed",
    error: { code: "model:recording_failed" },
  });
});
