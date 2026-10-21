import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  desktop: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("~/lib/platform", () => ({ isDesktopPlatform: mocks.desktop }));
vi.mock("sonner", () => ({ toast: { error: mocks.toast } }));
vi.mock("~/i18n/translate", () => ({
  translate: (message: { message?: string; id: string }) =>
    message.message ?? message.id,
}));

let controller: typeof import("./controller");
let store: typeof import("~/store/updater");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function updateFixture() {
  return {
    version: "0.2.2",
    currentVersion: "0.2.1",
    body: "## 改进\n- 修复文件选择\n- 更清楚的更新反馈",
    download: vi.fn<Update["download"]>().mockResolvedValue(undefined),
    install: vi.fn<Update["install"]>().mockResolvedValue(undefined),
    close: vi.fn<Update["close"]>().mockResolvedValue(undefined),
  };
}

async function available(update = updateFixture()) {
  mocks.check.mockResolvedValue(update);
  await controller.checkForUpdateManually();
  return update;
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  vi.stubEnv("PROD", true);
  mocks.desktop.mockReturnValue(true);
  mocks.relaunch.mockResolvedValue(undefined);
  controller = await import("./controller");
  store = await import("~/store/updater");
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("关闭更新弹窗不取消下载，再次手动检查重新显示并复用任务", async () => {
  const update = await available();
  const pending = deferred<void>();
  update.download.mockReturnValue(pending.promise);
  const task = controller.startUpdateDownload();
  controller.closeUpdaterDialog();
  expect(store.useUpdaterStore.getState()).toMatchObject({
    status: "downloading",
    dialogOpen: false,
  });
  expect(update.close).not.toHaveBeenCalled();
  store.setUpdaterState({ downloaded: 128 });
  expect(store.useUpdaterStore.getState().downloaded).toBe(128);
  const reopened = controller.checkForUpdateManually();
  expect(store.useUpdaterStore.getState().dialogOpen).toBe(true);
  expect(update.download).toHaveBeenCalledTimes(1);
  expect(mocks.check).toHaveBeenCalledTimes(1);
  pending.resolve();
  await Promise.all([task, reopened]);
});

it("检查时关闭再打开复用原生请求，迟到的句柄仍可下载", async () => {
  const pending = deferred<ReturnType<typeof updateFixture>>();
  mocks.check.mockReturnValue(pending.promise);
  const first = controller.checkForUpdateManually();
  controller.closeUpdaterDialog();
  const second = controller.checkForUpdateManually();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(mocks.check).toHaveBeenCalledTimes(1);
  expect(store.useUpdaterStore.getState()).toMatchObject({
    status: "checking",
    dialogOpen: true,
  });
  const update = updateFixture();
  pending.resolve(update);
  await Promise.all([first, second]);
  await controller.startUpdateDownload();
  expect(update.download).toHaveBeenCalledTimes(1);
  expect(update.close).not.toHaveBeenCalled();
});

it("启动检查不抢焦点，手动进入复用启动检查且只执行一次", async () => {
  const pending = deferred<ReturnType<typeof updateFixture>>();
  mocks.check.mockReturnValue(pending.promise);
  const launch = controller.checkForUpdateOnLaunch();
  expect(store.useUpdaterStore.getState().dialogOpen).toBe(false);
  controller.checkForUpdateOnLaunch();
  const manual = controller.checkForUpdateManually();
  pending.resolve(updateFixture());
  await Promise.all([launch, manual]);
  expect(mocks.check).toHaveBeenCalledTimes(1);
  expect(store.useUpdaterStore.getState()).toMatchObject({
    status: "available",
    dialogOpen: true,
  });
});

it("首包前立即反馈，慢连接提示后未知总量正常累计，收起不取消或重复下载", async () => {
  const update = await available();
  const pending = deferred<void>();
  let emit!: (event: DownloadEvent) => void;
  update.download.mockImplementation((onEvent) => {
    emit = onEvent!;
    return pending.promise;
  });
  const first = controller.startUpdateDownload();
  expect(store.useUpdaterStore.getState()).toMatchObject({
    status: "downloading",
    phase: "connecting",
    downloaded: 0,
  });
  controller.closeUpdaterDialog();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(store.useUpdaterStore.getState()).toMatchObject({
    dialogOpen: false,
    connectionSlow: true,
  });
  const second = controller.startUpdateDownload();
  emit({ event: "Started", data: {} });
  emit({ event: "Progress", data: { chunkLength: 512 } });
  emit({ event: "Progress", data: { chunkLength: 256 } });
  await vi.advanceTimersByTimeAsync(120);
  expect(store.useUpdaterStore.getState()).toMatchObject({
    phase: "downloading",
    downloaded: 768,
    total: undefined,
    connectionSlow: false,
  });
  controller.openUpdaterDialog();
  expect(store.useUpdaterStore.getState().downloaded).toBe(768);
  emit({ event: "Finished" });
  expect(store.useUpdaterStore.getState().phase).toBe("verifying");
  expect(update.install).not.toHaveBeenCalled();
  pending.resolve();
  await Promise.all([first, second]);
  expect(store.useUpdaterStore.getState().status).toBe("ready");
  expect(update.download).toHaveBeenCalledTimes(1);
  expect(update.download.mock.calls[0][1]).toEqual({ timeout: 1_800_000 });
  expect(vi.getTimerCount()).toBe(0);
});

it("已知总量只使用真实已接收字节，不在完成时补造下载量", async () => {
  const update = await available();
  update.download.mockImplementation(async (emit) => {
    emit!({ event: "Started", data: { contentLength: 1024 } });
    emit!({ event: "Progress", data: { chunkLength: 1000 } });
    emit!({ event: "Finished" });
  });
  await controller.startUpdateDownload();
  expect(store.useUpdaterStore.getState()).toMatchObject({
    downloaded: 1000,
    total: 1024,
    status: "ready",
  });
});

it("重启失败保留已安装状态，重复点击和重试均不重新下载或安装", async () => {
  const update = await available();
  await controller.startUpdateDownload();
  controller.closeUpdaterDialog();
  await controller.checkForUpdateManually();
  expect(update.install).not.toHaveBeenCalled();
  const pending = deferred<void>();
  mocks.relaunch.mockReturnValueOnce(pending.promise);
  const first = controller.restartToApplyUpdate();
  const second = controller.restartToApplyUpdate();
  await vi.advanceTimersByTimeAsync(0);
  expect(update.install).toHaveBeenCalledTimes(1);
  expect(mocks.relaunch).toHaveBeenCalledTimes(1);
  pending.reject(new Error("private-token"));
  await Promise.all([first, second]);
  expect(store.useUpdaterStore.getState()).toMatchObject({
    status: "ready",
    installed: true,
    error: { code: "updater:restart_failed" },
  });
  await controller.restartToApplyUpdate();
  expect(update.download).toHaveBeenCalledTimes(1);
  expect(update.install).toHaveBeenCalledTimes(1);
  expect(update.close).toHaveBeenCalledTimes(1);
  expect(mocks.relaunch).toHaveBeenCalledTimes(2);
});

it("安装失败保留下载句柄，用户显式重试才再次安装", async () => {
  const update = await available();
  await controller.startUpdateDownload();
  update.install.mockRejectedValueOnce("installer diagnostic");
  await controller.restartToApplyUpdate();
  expect(store.useUpdaterStore.getState()).toMatchObject({
    status: "ready",
    installed: false,
    error: { code: "updater:install_failed" },
  });
  expect(update.close).not.toHaveBeenCalled();
  expect(mocks.relaunch).not.toHaveBeenCalled();
  await controller.restartToApplyUpdate();
  expect(update.install).toHaveBeenCalledTimes(2);
  expect(update.download).toHaveBeenCalledTimes(1);
});

it("下载失败释放句柄并保留结构化错误，不自动重新检查或下载", async () => {
  const update = await available();
  const error = {
    kind: "external",
    code: "network:offline",
    message: "Unavailable",
    args: { source: "test" },
  };
  update.download.mockRejectedValue(error);
  await controller.startUpdateDownload();
  expect(store.useUpdaterStore.getState().error).toEqual(error);
  expect(store.useUpdaterStore.getState().status).toBe("error");
  expect(update.close).toHaveBeenCalledTimes(1);
  expect(mocks.check).toHaveBeenCalledTimes(1);
  const replacement = updateFixture();
  mocks.check.mockResolvedValue(replacement);
  await controller.checkForUpdateManually();
  expect(store.useUpdaterStore.getState().status).toBe("available");
  expect(replacement.download).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  "None of the fallback platforms",
  "error sending request",
  "timed out",
  "任意改写的诊断",
])("检查失败不根据文案猜原因：%s", async (message) => {
  mocks.check.mockRejectedValue(new Error(message));
  await controller.checkForUpdateManually();
  expect(store.useUpdaterStore.getState().error).toMatchObject({
    kind: "external",
    code: "updater:check_failed",
    message: "Update check failed",
  });
});

it("关闭最新版本结果回到空闲，移动端和浏览器不调用更新插件", async () => {
  mocks.check.mockResolvedValue(null);
  await controller.checkForUpdateManually();
  expect(store.useUpdaterStore.getState().status).toBe("current");
  controller.closeUpdaterDialog();
  expect(store.useUpdaterStore.getState().status).toBe("idle");
  mocks.desktop.mockReturnValue(false);
  await controller.checkForUpdateManually();
  await controller.startUpdateDownload();
  await controller.restartToApplyUpdate();
  mocks.desktop.mockReturnValue(true);
  vi.stubGlobal("window", {});
  await controller.checkForUpdateManually();
  expect(mocks.check).toHaveBeenCalledTimes(1);
});

it("下载任务完成后忽略迟到进度，定时器不会改写准备完成状态", async () => {
  const update = await available();
  let emit!: (event: DownloadEvent) => void;
  update.download.mockImplementation(async (callback) => {
    emit = callback!;
  });
  await controller.startUpdateDownload();
  const before = store.useUpdaterStore.getState();
  emit({ event: "Started", data: { contentLength: 999 } });
  emit({ event: "Progress", data: { chunkLength: 999 } });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(store.useUpdaterStore.getState()).toEqual(before);
  expect(vi.getTimerCount()).toBe(0);
});

it("静默检查无更新不弹窗，也不留下无用状态入口", async () => {
  mocks.check.mockResolvedValue(null);
  await controller.checkForUpdateOnLaunch();
  expect(store.useUpdaterStore.getState()).toMatchObject({
    status: "idle",
    dialogOpen: false,
  });
  expect(mocks.toast).not.toHaveBeenCalled();
});
