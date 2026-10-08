import { beforeEach, expect, it, vi } from "vitest";

import { IpcError } from "~/lib/errors";
import { downloadBlob } from "~/lib/files";

import { ScreenshotExport } from "./screenshot";

vi.mock("~/lib/files", async (original) => ({
  ...(await original<typeof import("~/lib/files")>()),
  downloadBlob: vi.fn(),
}));
const blob = new Blob(["png"], { type: "image/png" });

beforeEach(() => vi.resetAllMocks());

it("捕获期间重复点击只导出一次，取消保存不报成功", async () => {
  let finish!: (value: Blob) => void;
  const capture = vi.fn(
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  vi.mocked(downloadBlob).mockResolvedValue(false);
  const controller = new ScreenshotExport();
  const pending = controller.save(capture, "model.glb");
  await controller.save(capture, "other.glb");
  expect(capture).toHaveBeenCalledTimes(1);
  finish(blob);
  await pending;
  expect(downloadBlob).toHaveBeenCalledTimes(1);
  expect(controller.snapshot().status).toBe("cancelled");
});

it("编码期间离开页面不打开保存对话框", async () => {
  let finish!: (value: Blob) => void;
  const controller = new ScreenshotExport();
  const pending = controller.save(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    "model.glb",
  );
  controller.cancel();
  finish(blob);
  await pending;
  expect(downloadBlob).not.toHaveBeenCalled();
  expect(controller.snapshot().status).toBe("cancelled");
});

it("保存进行中取消会传递信号并等待实际任务结束", async () => {
  let finish!: (value: number) => void;
  vi.mocked(downloadBlob).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new ScreenshotExport();
  const pending = controller.save(async () => blob, "model.glb");
  await vi.waitFor(() => expect(downloadBlob).toHaveBeenCalled());
  controller.cancel();
  expect(vi.mocked(downloadBlob).mock.calls[0][2]?.aborted).toBe(true);
  expect(controller.snapshot().status).toBe("busy");
  finish(3);
  await pending;
  expect(controller.snapshot().status).toBe("cancelled");
});

it("保存成功使用安全文件名，非结构化失败不展示插件原文", async () => {
  const controller = new ScreenshotExport();
  vi.mocked(downloadBlob).mockResolvedValue(3);
  await controller.save(async () => blob, "folder/test:bad.glb");
  expect(downloadBlob).toHaveBeenCalledWith(
    blob,
    expect.stringMatching(/^test_bad-\d+\.png$/),
    expect.any(AbortSignal),
  );
  expect(controller.snapshot().status).toBe("saved");
  vi.mocked(downloadBlob).mockRejectedValue("private plugin diagnostic");
  await controller.save(async () => blob, "model.glb");
  expect(controller.snapshot().error?.code).toBe("model:export");
});

it("保留已有结构化错误且失败写入不自动重试", async () => {
  const payload = {
    kind: "custom" as const,
    code: "app:data_busy",
    message: "Busy",
    args: {},
  };
  vi.mocked(downloadBlob).mockRejectedValue(new IpcError(payload));
  const controller = new ScreenshotExport();
  await controller.save(async () => blob, "model.glb");
  expect(controller.snapshot().error).toEqual(payload);
  expect(downloadBlob).toHaveBeenCalledTimes(1);
});

it("捕获失败保留阶段错误且不打开保存对话框", async () => {
  const controller = new ScreenshotExport();
  await controller.save(async () => {
    throw new Error("Canvas unavailable");
  }, "model.glb");
  expect(controller.snapshot()).toMatchObject({
    status: "failed",
    error: { code: "model:capture" },
  });
  expect(downloadBlob).not.toHaveBeenCalled();
});
