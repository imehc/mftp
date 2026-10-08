import { beforeEach, expect, it, vi } from "vitest";

import * as ipc from "~/lib/ipc";

import { readEnvironment, saveEnvironment } from "./environment-storage";

vi.mock("~/lib/ipc", () => ({
  modelEnvironmentAbort: vi.fn(),
  modelEnvironmentBegin: vi.fn(),
  modelEnvironmentClear: vi.fn(),
  modelEnvironmentCommit: vi.fn(),
  modelEnvironmentCurrent: vi.fn(),
  modelEnvironmentRead: vi.fn(),
  modelEnvironmentWrite: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ipc.modelEnvironmentBegin).mockResolvedValue("draft");
  vi.mocked(ipc.modelEnvironmentCurrent).mockResolvedValue(null);
});

it("环境保存按固定大小顺序写入，完整后仅提交一次", async () => {
  const file = new File([new Uint8Array(1024 * 1024 + 3)], "light.hdr");
  await saveEnvironment(file, new AbortController().signal);
  expect(
    vi
      .mocked(ipc.modelEnvironmentWrite)
      .mock.calls.map(([, offset, bytes]) => [offset, bytes.length]),
  ).toEqual([
    [0, 1024 * 1024],
    [1024 * 1024, 3],
  ]);
  expect(ipc.modelEnvironmentCommit).toHaveBeenCalledExactlyOnceWith("draft");
  expect(ipc.modelEnvironmentAbort).not.toHaveBeenCalled();
});

it("创建草稿期间取消只回收草稿，不提交或清除旧环境", async () => {
  const task = new AbortController();
  vi.mocked(ipc.modelEnvironmentBegin).mockImplementation(async () => {
    task.abort();
    return "draft";
  });
  await expect(
    saveEnvironment(new File(["hdr"], "light.hdr"), task.signal),
  ).rejects.toThrow();
  expect(ipc.modelEnvironmentAbort).toHaveBeenCalledExactlyOnceWith("draft");
  expect(ipc.modelEnvironmentWrite).not.toHaveBeenCalled();
  expect(ipc.modelEnvironmentCommit).not.toHaveBeenCalled();
  expect(ipc.modelEnvironmentClear).not.toHaveBeenCalled();
});

it("跨页面清除等待在途提交退出，恢复等待清除结束", async () => {
  let finish!: () => void;
  vi.mocked(ipc.modelEnvironmentCommit).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const save = saveEnvironment(
    new File(["hdr"], "light.hdr"),
    new AbortController().signal,
  );
  await vi.waitFor(() => expect(ipc.modelEnvironmentCommit).toHaveBeenCalled());
  const clear = saveEnvironment(null, new AbortController().signal);
  const read = readEnvironment(new AbortController().signal);
  expect(ipc.modelEnvironmentClear).not.toHaveBeenCalled();
  expect(ipc.modelEnvironmentCurrent).not.toHaveBeenCalled();
  finish();
  await Promise.all([save, clear, read]);
  expect(ipc.modelEnvironmentClear).toHaveBeenCalledOnce();
  expect(ipc.modelEnvironmentCurrent).toHaveBeenCalledOnce();
});

it("读取绑定同一版本 ID，长度不符时拒绝恢复", async () => {
  vi.mocked(ipc.modelEnvironmentCurrent).mockResolvedValue({
    id: "version",
    name: "light.hdr",
    size: 3,
  });
  vi.mocked(ipc.modelEnvironmentRead).mockResolvedValue([1, 2]);
  await expect(
    readEnvironment(new AbortController().signal),
  ).rejects.toMatchObject({ payload: { code: "model:invalid" } });
  expect(ipc.modelEnvironmentRead).toHaveBeenCalledExactlyOnceWith(
    "version",
    0,
  );
  vi.mocked(ipc.modelEnvironmentRead).mockResolvedValue([1, 2, 3]);
  const file = await readEnvironment(new AbortController().signal);
  expect(new Uint8Array(await file!.arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3]),
  );
});

it("写入失败不重放，也不阻塞后续显式清除", async () => {
  vi.mocked(ipc.modelEnvironmentWrite).mockRejectedValue(
    new Error("write failed"),
  );
  await expect(
    saveEnvironment(
      new File(["hdr"], "light.hdr"),
      new AbortController().signal,
    ),
  ).rejects.toThrow("write failed");
  expect(ipc.modelEnvironmentWrite).toHaveBeenCalledOnce();
  expect(ipc.modelEnvironmentAbort).toHaveBeenCalledOnce();
  await saveEnvironment(null, new AbortController().signal);
  expect(ipc.modelEnvironmentClear).toHaveBeenCalledOnce();
});
