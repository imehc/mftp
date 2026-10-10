import { msg } from "@lingui/core/macro";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { toast } from "sonner";

import { translate } from "~/i18n/translate";
import { frontendError, toIpcError } from "~/lib/errors";
import type { FrontendErrorCode } from "~/lib/errors/messages";
import { isDesktopPlatform } from "~/lib/platform";
import {
  initialUpdaterState,
  resetUpdaterState,
  setUpdaterState,
  useUpdaterStore,
} from "~/store/updater";

import { prepareReleaseNotes } from "./release-notes";

const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const SLOW_CONNECTION_MS = 10_000;
let checkedOnLaunch = false;
let activeUpdate: Update | null = null;
let checkTask: Promise<void> | null = null;
let downloadTask: Promise<void> | null = null;
let restartTask: Promise<void> | null = null;

function supported() {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window &&
    isDesktopPlatform()
  );
}

function updateError(
  error: unknown,
  code: FrontendErrorCode,
  diagnostic: string,
) {
  const payload = toIpcError(error).payload;
  // 插件只给字符串时，按已知操作阶段映射；不猜网络/签名/平台错误，
  // 也不把可能含 URL 参数的原始异常写入 UI 或日志。
  if (
    ["frontend:error", "frontend:unknown", "legacy:raw"].includes(payload.code)
  ) {
    return frontendError(code, diagnostic);
  }
  return payload;
}

async function releaseUpdate(update: Update | null) {
  if (!update) return;
  try {
    await update.close();
  } catch {
    console.warn("Failed to release updater resource");
  }
}

export function openUpdaterDialog() {
  setUpdaterState({ dialogOpen: true });
}

export function dismissUpdaterBanner() {
  // 隐藏展示不影响更新任务及错误；状态留在内存中，跨页面仍保持关闭。
  setUpdaterState({ bannerDismissed: true });
}

export function closeUpdaterDialog() {
  if (useUpdaterStore.getState().status === "current") resetUpdaterState();
  else setUpdaterState({ dialogOpen: false });
}

export function checkForUpdateOnLaunch() {
  if (
    checkedOnLaunch ||
    !import.meta.env.PROD ||
    !supported() ||
    useUpdaterStore.getState().status !== "idle"
  )
    return;
  checkedOnLaunch = true;
  return beginCheck(false);
}

export function checkForUpdateManually() {
  if (!supported()) {
    toast.error(translate(msg`只能在桌面应用中检查更新`));
    return Promise.resolve();
  }
  setUpdaterState({ bannerDismissed: false });
  openUpdaterDialog();
  if (checkTask) return checkTask;
  if (downloadTask) return downloadTask;
  if (restartTask) return restartTask;
  if (
    ["available", "downloading", "ready", "restarting"].includes(
      useUpdaterStore.getState().status,
    )
  )
    return Promise.resolve();
  return beginCheck(true);
}

function beginCheck(manual: boolean) {
  setUpdaterState({
    ...initialUpdaterState,
    status: "checking",
    dialogOpen: manual,
  });
  // 只使用原生请求时限；前端 Promise.race 会遗失迟到的 Update 句柄。
  checkTask = performCheck(manual).finally(() => {
    checkTask = null;
  });
  return checkTask;
}

async function performCheck(manual: boolean) {
  try {
    const previous = activeUpdate;
    activeUpdate = null;
    await releaseUpdate(previous);
    const update = await check({ timeout: CHECK_TIMEOUT_MS });
    if (!update) {
      setUpdaterState({
        status:
          manual || useUpdaterStore.getState().dialogOpen ? "current" : "idle",
      });
      return;
    }
    activeUpdate = update;
    const notes = prepareReleaseNotes(update.body ?? "");
    setUpdaterState({
      status: "available",
      version: update.version,
      currentVersion: update.currentVersion,
      releaseNotes: notes.text,
      notesTruncated: notes.truncated,
    });
  } catch (error) {
    if (manual || useUpdaterStore.getState().dialogOpen) {
      setUpdaterState({
        status: "error",
        error: updateError(
          error,
          "updater:check_failed",
          "Update check failed",
        ),
      });
    } else resetUpdaterState();
  }
}

export function startUpdateDownload() {
  if (!supported()) return Promise.resolve();
  if (downloadTask) return downloadTask;
  if (useUpdaterStore.getState().status !== "available")
    return Promise.resolve();
  const update = activeUpdate;
  if (!update) {
    setUpdaterState({
      status: "error",
      error: frontendError("updater:expired", "Update resource is unavailable"),
    });
    return Promise.resolve();
  }
  setUpdaterState({
    status: "downloading",
    phase: "connecting",
    connectionSlow: false,
    downloaded: 0,
    total: undefined,
    error: null,
  });
  downloadTask = downloadUpdate(update).finally(() => {
    downloadTask = null;
  });
  return downloadTask;
}

async function downloadUpdate(update: Update) {
  let received = 0;
  let receiving = true;
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  const connectionTimer = setTimeout(() => {
    if (useUpdaterStore.getState().phase === "connecting")
      setUpdaterState({ connectionSlow: true });
  }, SLOW_CONNECTION_MS);

  const flushProgress = () => {
    clearTimeout(progressTimer);
    progressTimer = undefined;
    setUpdaterState({ downloaded: received });
  };

  function onEvent(event: DownloadEvent) {
    if (!receiving) return;
    if (event.event === "Started") {
      clearTimeout(connectionTimer);
      const total = event.data.contentLength;
      setUpdaterState({
        phase: "downloading",
        connectionSlow: false,
        total: total && Number.isFinite(total) && total > 0 ? total : undefined,
      });
    } else if (event.event === "Progress") {
      clearTimeout(connectionTimer);
      received += event.data.chunkLength;
      if (useUpdaterStore.getState().phase === "connecting")
        setUpdaterState({ phase: "downloading", connectionSlow: false });
      // 小数据块不逐个驱动整个弹窗；结束时立即刷新真实累计值。
      progressTimer ??= setTimeout(flushProgress, 120);
    } else {
      clearTimeout(connectionTimer);
      flushProgress();
      setUpdaterState({ phase: "verifying", connectionSlow: false });
    }
  }

  try {
    await update.download(onEvent, { timeout: DOWNLOAD_TIMEOUT_MS });
    flushProgress();
    setUpdaterState({ status: "ready", error: null });
  } catch (error) {
    flushProgress();
    activeUpdate = null;
    await releaseUpdate(update);
    setUpdaterState({
      status: "error",
      error: updateError(
        error,
        "updater:download_failed",
        "Update download or verification failed",
      ),
    });
  } finally {
    receiving = false;
    clearTimeout(connectionTimer);
    clearTimeout(progressTimer);
  }
}

export function restartToApplyUpdate() {
  if (!supported()) return Promise.resolve();
  if (restartTask) return restartTask;
  if (downloadTask || useUpdaterStore.getState().status !== "ready")
    return Promise.resolve();
  setUpdaterState({ status: "restarting", error: null });
  restartTask = installAndRestart().finally(() => {
    restartTask = null;
  });
  return restartTask;
}

async function installAndRestart() {
  try {
    if (!useUpdaterStore.getState().installed) {
      if (!activeUpdate) {
        setUpdaterState({
          status: "error",
          error: frontendError(
            "updater:expired",
            "Update resource is unavailable",
          ),
        });
        return;
      }
      // Windows 在 install 中启动安装器并退出；只能由用户显式触发。
      await activeUpdate.install();
      setUpdaterState({ installed: true });
      const update = activeUpdate;
      activeUpdate = null;
      await releaseUpdate(update);
    }
    await relaunch();
  } catch (error) {
    const installed = useUpdaterStore.getState().installed;
    setUpdaterState({
      status: "ready",
      error: updateError(
        error,
        installed ? "updater:restart_failed" : "updater:install_failed",
        installed ? "Application restart failed" : "Update installation failed",
      ),
    });
  }
}
