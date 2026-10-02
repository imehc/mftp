import { beforeEach, expect, it, vi } from "vitest";
import { resetApplicationData } from "./reset-app-data";
import { appDataReset } from "~/lib/ipc";
import { isDesktopPlatform } from "~/lib/platform";
import { disable } from "@tauri-apps/plugin-autostart";
vi.mock("~/lib/ipc", () => ({ appDataReset: vi.fn() }));
vi.mock("~/lib/platform", () => ({ isDesktopPlatform: vi.fn() }));
vi.mock("@tauri-apps/plugin-autostart", () => ({ disable: vi.fn() }));
const failure = {
  kind: "external" as const,
  code: "io:operation",
  message: "Synthetic failure",
  args: {},
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(appDataReset).mockResolvedValue({
    recordsDeleted: 1,
    bytesFreed: 0,
    preserved: [],
  });
  vi.mocked(isDesktopPlatform).mockReturnValue(true);
});
it("后端拒绝时不更改系统启动和任何偏好", async () => {
  const removeItem = vi.fn();
  vi.mocked(appDataReset).mockRejectedValue(failure);
  await expect(resetApplicationData({ removeItem })).rejects.toEqual(failure);
  expect(removeItem).not.toHaveBeenCalled();
  expect(disable).not.toHaveBeenCalled();
});
it("后端成功后按顺序清理系统启动与应用键", async () => {
  const order: string[] = [];
  vi.mocked(appDataReset).mockImplementation(async () => {
    order.push("backend");
    return { recordsDeleted: 1, bytesFreed: 0, preserved: [] };
  });
  vi.mocked(disable).mockImplementation(async () => {
    order.push("autostart");
  });
  expect(
    await resetApplicationData({
      removeItem: (key) => {
        order.push(key);
      },
    }),
  ).toEqual([]);
  expect(order).toEqual([
    "backend",
    "autostart",
    "mftp-settings",
    "mftp-games-history",
    "mftp-poetry",
  ]);
});
it("移动端不调用开机启动，单项偏好失败仍清理后续项并返回诊断", async () => {
  vi.mocked(isDesktopPlatform).mockReturnValue(false);
  const removed: string[] = [];
  const warnings = await resetApplicationData({
    removeItem: (key) => {
      removed.push(key);
      if (key === "mftp-settings") throw failure;
    },
  });
  expect(disable).not.toHaveBeenCalled();
  expect(removed).toHaveLength(3);
  expect(warnings).toEqual([failure]);
});
it("系统设置失败不能伪装成后端重置失败或自动重放重置", async () => {
  vi.mocked(disable).mockRejectedValue(failure);
  const removeItem = vi.fn();
  expect(await resetApplicationData({ removeItem })).toEqual([failure]);
  expect(appDataReset).toHaveBeenCalledTimes(1);
  expect(removeItem).toHaveBeenCalledTimes(3);
});
