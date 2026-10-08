import { disable } from "@tauri-apps/plugin-autostart";
import { beforeEach, expect, it, vi } from "vitest";

import type { AppDataResetResult } from "~/bindings";
import {
  appDataReset,
  appDataResetFinish,
  appDataResetResume,
} from "~/lib/ipc";
import { isDesktopPlatform } from "~/lib/platform";

import { resetApplicationData } from "./reset-app-data";

vi.mock("~/lib/ipc", () => ({
  appDataReset: vi.fn(),
  appDataResetFinish: vi.fn(),
  appDataResetResume: vi.fn(),
}));
vi.mock("~/lib/platform", () => ({ isDesktopPlatform: vi.fn() }));
vi.mock("@tauri-apps/plugin-autostart", () => ({ disable: vi.fn() }));
const failure = {
  kind: "external" as const,
  code: "io:operation",
  message: "Synthetic failure",
  args: {},
};
const result: AppDataResetResult = {
  progress: { id: "reset-id", pending: [], recordsDeleted: 1 },
  failures: [],
  recordsDeleted: 1,
  bytesFreed: 0,
  usageError: null,
  preserved: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(appDataReset).mockResolvedValue(result);
  vi.mocked(appDataResetResume).mockResolvedValue(result);
  vi.mocked(isDesktopPlatform).mockReturnValue(true);
});

it("后端拒绝时不更改系统启动和任何偏好", async () => {
  const removeItem = vi.fn();
  vi.mocked(appDataReset).mockRejectedValue(failure);
  await expect(resetApplicationData({ removeItem })).rejects.toEqual(failure);
  expect(removeItem).not.toHaveBeenCalled();
  expect(disable).not.toHaveBeenCalled();
  expect(appDataResetFinish).not.toHaveBeenCalled();
});

it("部分完成时保留具体阶段和错误，不提前清理偏好或确认完成", async () => {
  const partial = {
    ...result,
    progress: { ...result.progress, pending: ["poetry" as const] },
    failures: [{ step: "poetry" as const, error: failure }],
  };
  vi.mocked(appDataReset).mockResolvedValue(partial);
  const removeItem = vi.fn();
  expect(await resetApplicationData({ removeItem })).toEqual({
    result: partial,
    warnings: [],
    finished: false,
  });
  expect(removeItem).not.toHaveBeenCalled();
  expect(appDataResetFinish).not.toHaveBeenCalled();
});

it("后端完成后先清理系统启动与偏好，再确认操作完成", async () => {
  const order: string[] = [];
  vi.mocked(appDataReset).mockImplementation(async () => {
    order.push("backend");
    return result;
  });
  vi.mocked(disable).mockImplementation(async () => {
    order.push("autostart");
  });
  vi.mocked(appDataResetFinish).mockImplementation(async () => {
    order.push("finish");
  });
  const outcome = await resetApplicationData({
    removeItem: (key) => {
      order.push(key);
    },
  });
  expect(outcome.finished).toBe(true);
  expect(order).toEqual([
    "backend",
    "autostart",
    "mftp-settings",
    "mftp-games-history",
    "mftp-poetry",
    "theme",
    "finish",
  ]);
  expect(appDataResetFinish).toHaveBeenCalledWith("reset-id");
});

it("移动端不调用开机启动，偏好失败仍处理后续项并保留恢复记录", async () => {
  vi.mocked(isDesktopPlatform).mockReturnValue(false);
  const removed: string[] = [];
  const outcome = await resetApplicationData({
    removeItem: (key) => {
      removed.push(key);
      if (key === "mftp-settings") throw failure;
    },
  });
  expect(disable).not.toHaveBeenCalled();
  expect(removed).toHaveLength(4);
  expect(outcome.warnings).toEqual([failure]);
  expect(outcome.finished).toBe(false);
  expect(appDataResetFinish).not.toHaveBeenCalled();
});

it("系统设置失败后显式恢复只调用继续接口，不重放主库重置", async () => {
  vi.mocked(disable).mockRejectedValueOnce(failure);
  const preferences = { removeItem: vi.fn() };
  expect((await resetApplicationData(preferences)).finished).toBe(false);
  expect(appDataResetFinish).not.toHaveBeenCalled();
  expect((await resetApplicationData(preferences, "reset-id")).finished).toBe(
    true,
  );
  expect(appDataReset).toHaveBeenCalledTimes(1);
  expect(appDataResetResume).toHaveBeenCalledWith("reset-id");
});

it("确认完成失败保留错误，容量统计失败不阻止实际完成", async () => {
  vi.mocked(appDataResetFinish).mockRejectedValueOnce(failure);
  expect((await resetApplicationData({ removeItem: vi.fn() })).finished).toBe(
    false,
  );
  vi.mocked(appDataResetResume).mockResolvedValue({
    ...result,
    bytesFreed: null,
    usageError: failure,
  });
  const outcome = await resetApplicationData(
    { removeItem: vi.fn() },
    "reset-id",
  );
  expect(outcome.finished).toBe(true);
  expect(outcome.warnings).toEqual([failure]);
  expect(appDataReset).toHaveBeenCalledTimes(1);
});
