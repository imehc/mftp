import { beforeEach, expect, it, vi } from "vitest";

import { IpcError } from "~/lib/errors";
import { downloadBlob, isTauriRuntime } from "~/lib/files";
import * as ipc from "~/lib/ipc";
import { isMobilePlatform } from "~/lib/platform";

import { exportBlob } from "./native-export";

vi.mock("~/lib/files", () => ({
  downloadBlob: vi.fn(),
  isTauriRuntime: vi.fn(),
}));
vi.mock("~/lib/platform", () => ({ isMobilePlatform: vi.fn() }));
vi.mock("~/lib/ipc", () => ({
  modelExportBegin: vi.fn(),
  modelExportWrite: vi.fn(),
  modelExportPresent: vi.fn(),
  modelExportCancel: vi.fn(),
  modelExportClose: vi.fn(),
}));
const blob = new Blob(["png"], { type: "image/png" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isTauriRuntime).mockReturnValue(true);
  vi.mocked(isMobilePlatform).mockReturnValue(true);
  vi.mocked(ipc.modelExportBegin).mockResolvedValue("owned-id");
  vi.mocked(ipc.modelExportPresent).mockResolvedValue("presented");
  vi.mocked(ipc.modelExportCancel).mockResolvedValue();
});

it("移动分享先完整写入分片再呈现系统面板，最后关闭句柄", async () => {
  const data = new Blob([new Uint8Array(1024 * 1024 + 3)], {
    type: "video/mp4",
  });
  expect(
    await exportBlob(data, "video.mp4", "share", new AbortController().signal),
  ).toBe("presented");
  const calls = vi.mocked(ipc.modelExportWrite).mock.calls;
  expect(calls.map((call) => [call[1], call[2].length])).toEqual([
    [0, 1024 * 1024],
    [1024 * 1024, 3],
  ]);
  expect(ipc.modelExportPresent).toHaveBeenCalledWith("owned-id", "share");
  expect(ipc.modelExportClose).toHaveBeenCalledWith("owned-id");
  expect(downloadBlob).not.toHaveBeenCalled();
});

it("暂存创建期间取消仍回收刚创建的导出，不弹系统面板", async () => {
  const controller = new AbortController();
  vi.mocked(ipc.modelExportBegin).mockImplementation(async () => {
    controller.abort();
    return "owned-id";
  });
  expect(await exportBlob(blob, "test.png", "save", controller.signal)).toBe(
    "cancelled",
  );
  expect(ipc.modelExportWrite).not.toHaveBeenCalled();
  expect(ipc.modelExportPresent).not.toHaveBeenCalled();
  expect(ipc.modelExportClose).toHaveBeenCalledWith("owned-id");
});

it("系统面板期间取消发送指定 ID，等待实际回调再清理", async () => {
  const controller = new AbortController();
  let complete!: () => void;
  vi.mocked(ipc.modelExportPresent).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = () => resolve("saved");
      }),
  );
  const pending = exportBlob(blob, "test.png", "save", controller.signal);
  await vi.waitFor(() => expect(ipc.modelExportPresent).toHaveBeenCalled());
  controller.abort();
  expect(ipc.modelExportCancel).toHaveBeenCalledWith("owned-id");
  expect(ipc.modelExportClose).not.toHaveBeenCalled();
  complete();
  expect(await pending).toBe("cancelled");
  expect(ipc.modelExportClose).toHaveBeenCalledOnce();
});

it("写入失败不自动重试，保留 AppError 及清理失败代码", async () => {
  const error = new IpcError({
    kind: "external",
    code: "fs:write",
    message: "Write failed",
    args: {},
  });
  vi.mocked(ipc.modelExportWrite).mockRejectedValue(error);
  vi.mocked(ipc.modelExportClose).mockRejectedValue(
    new IpcError({
      kind: "external",
      code: "fs:close",
      message: "Close failed",
      args: {},
    }),
  );
  await expect(
    exportBlob(blob, "test.png", "save", new AbortController().signal),
  ).rejects.toMatchObject({
    payload: { code: "fs:write", args: { cleanupCode: "fs:close" } },
  });
  expect(ipc.modelExportWrite).toHaveBeenCalledOnce();
  expect(ipc.modelExportPresent).not.toHaveBeenCalled();
});

it("桌面保存沿用公共保存工具，不创建移动暂存", async () => {
  vi.mocked(isMobilePlatform).mockReturnValue(false);
  vi.mocked(downloadBlob).mockResolvedValue(false);
  expect(
    await exportBlob(blob, "test.png", "save", new AbortController().signal),
  ).toBe("cancelled");
  expect(ipc.modelExportBegin).not.toHaveBeenCalled();
});
