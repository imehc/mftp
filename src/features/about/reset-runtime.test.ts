import { isTauri } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { appDataResetStatus } from "~/lib/ipc";

import { resetApplicationData } from "./reset-app-data";
import {
  inspectReset,
  returnFromRejectedReset,
  startReset,
  useResetStore,
} from "./reset-runtime";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => true) }));
vi.mock("~/lib/ipc", () => ({ appDataResetStatus: vi.fn() }));
vi.mock("./reset-app-data", () => ({ resetApplicationData: vi.fn() }));
const failure = {
  kind: "external" as const,
  code: "io:operation",
  message: "Synthetic failure",
  args: {},
};
const progress = {
  id: "existing-reset",
  recordsDeleted: 1,
  pending: ["credentials" as const],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.stubGlobal("localStorage", { removeItem: vi.fn() });
  vi.stubGlobal("window", { location: { assign: vi.fn() } });
  useResetStore.setState({
    phase: "checking",
    progress: null,
    errors: [],
    failures: [],
    canReturn: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("启动只读取恢复记录，不自动继续删除或清理偏好", async () => {
  vi.mocked(appDataResetStatus).mockResolvedValue(progress);
  await inspectReset();
  expect(useResetStore.getState().phase).toBe("pending");
  expect(useResetStore.getState().progress).toEqual(progress);
  expect(resetApplicationData).not.toHaveBeenCalled();
});

it("完成确认响应丢失后查到记录已消失时重新加载，不复用旧内存页面", async () => {
  useResetStore.setState({ phase: "pending", progress });
  vi.mocked(appDataResetStatus).mockResolvedValue(null);
  await inspectReset();
  expect(useResetStore.getState().phase).toBe("finished");
  expect(window.location.assign).toHaveBeenCalledWith("/");
  expect(resetApplicationData).not.toHaveBeenCalled();
});

it("查询失败不会进入业务页面，重试也只查询", async () => {
  vi.mocked(appDataResetStatus)
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce(null);
  await inspectReset();
  expect(useResetStore.getState().phase).toBe("failed");
  expect(useResetStore.getState().canReturn).toBe(false);
  await inspectReset();
  expect(useResetStore.getState().phase).toBe("idle");
  expect(resetApplicationData).not.toHaveBeenCalled();
});

it("重复点击共用同一请求，立即退出业务页面", async () => {
  let reject!: (reason: unknown) => void;
  vi.mocked(resetApplicationData).mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  vi.mocked(appDataResetStatus).mockResolvedValue(null);
  const first = startReset();
  const second = startReset();
  expect(first).toBe(second);
  expect(useResetStore.getState().phase).toBe("running");
  expect(resetApplicationData).toHaveBeenCalledTimes(1);
  reject(failure);
  await first;
  expect(useResetStore.getState().canReturn).toBe(true);
  returnFromRejectedReset();
  expect(useResetStore.getState().phase).toBe("idle");
});

it("请求报错后发现主库已提交时保留恢复，不提供返回旧应用入口", async () => {
  vi.mocked(resetApplicationData).mockRejectedValue(failure);
  vi.mocked(appDataResetStatus).mockResolvedValue(progress);
  await startReset();
  expect(useResetStore.getState().progress).toEqual(progress);
  expect(useResetStore.getState().canReturn).toBe(false);
  returnFromRejectedReset();
  expect(useResetStore.getState().phase).toBe("failed");
  expect(resetApplicationData).toHaveBeenCalledTimes(1);
});

it("显式继续携带原操作标识，完成后重新载入清空内存状态", async () => {
  useResetStore.setState({ phase: "pending", progress });
  vi.mocked(resetApplicationData).mockResolvedValue({
    result: {
      progress: { ...progress, pending: [] },
      failures: [],
      recordsDeleted: 1,
      bytesFreed: null,
      usageError: null,
      preserved: [],
    },
    warnings: [],
    finished: true,
  });
  await startReset(true);
  expect(resetApplicationData).toHaveBeenCalledWith(localStorage, progress.id);
  expect(window.location.assign).toHaveBeenCalledWith("/");
});

it("普通浏览器不请求原生状态，失败后的状态读取仍失败时保持封闭", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  await inspectReset();
  expect(appDataResetStatus).not.toHaveBeenCalled();
  vi.mocked(resetApplicationData).mockRejectedValue(failure);
  vi.mocked(appDataResetStatus).mockRejectedValue(failure);
  await startReset();
  expect(useResetStore.getState().canReturn).toBe(false);
  expect(useResetStore.getState().errors).toHaveLength(2);
});
