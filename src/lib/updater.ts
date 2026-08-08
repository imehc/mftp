import { createElement, type ReactNode } from "react";
import { msg } from "@lingui/core/macro";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";
import { translate } from "~/i18n/translate";
import { isDesktopPlatform } from "~/lib/platform";
import { formatBytes } from "~/lib/format";
import {
  resetUpdaterState,
  setUpdaterState,
  useUpdaterStore,
} from "~/store/updater";

let checkedOnLaunch = false;
let activeUpdate: Update | null = null;
let downloadTask: Promise<void> | null = null;

const UPDATE_CHECK_TIMEOUT_MS = 15_000;
const UPDATE_TOAST_ID = "app-update";
const MAX_RELEASE_NOTES = 8;

export async function checkForUpdateOnLaunch() {
  if (
    checkedOnLaunch ||
    !import.meta.env.PROD ||
    !isTauriRuntime() ||
    !isDesktopPlatform() ||
    useUpdaterStore.getState().status !== "idle"
  ) {
    return;
  }

  checkedOnLaunch = true;

  try {
    const update = await checkWithTimeout();
    if (!update) return;
    registerAvailableUpdate(update);
  } catch (error) {
    console.warn("update check failed", error);
  }
}

export async function checkForUpdateManually() {
  if (!isTauriRuntime() || !isDesktopPlatform()) {
    toast.error(translate(msg`只能在桌面应用中检查更新`));
    return;
  }

  const state = useUpdaterStore.getState();
  if (state.status === "checking") {
    showCheckingToast();
    return;
  }
  if (state.status === "available") {
    showAvailableUpdateToast();
    return;
  }
  if (state.status === "downloading") {
    showDownloadProgressToast();
    return;
  }
  if (state.status === "ready") {
    showReadyToRestartToast();
    return;
  }
  if (state.status === "restarting") {
    showRestartingToast();
    return;
  }

  setUpdaterState({
    status: "checking",
    version: null,
    releaseNotes: [],
    downloaded: 0,
    total: undefined,
    phase: "downloading",
    error: null,
  });
  showCheckingToast();

  try {
    const update = await checkWithTimeout();
    if (!update) {
      resetUpdaterState();
      toast.success(translate(msg`当前已是最新版本`), { id: UPDATE_TOAST_ID });
      return;
    }

    registerAvailableUpdate(update);
  } catch (error) {
    console.warn("manual update check failed", error);
    const message = updateErrorTitle(error);
    setUpdaterState({ status: "error", error: message });
    toast.error(message, {
      id: UPDATE_TOAST_ID,
      closeButton: true,
    });
  }
}

export async function restartToApplyUpdate() {
  const state = useUpdaterStore.getState();
  if (state.status !== "ready" && state.status !== "restarting") return;

  setUpdaterState({ status: "restarting", error: null });
  showRestartingToast();

  try {
    await relaunch();
  } catch (error) {
    console.warn("update relaunch failed", error);
    const message = translate(msg`重启失败：${formatError(error)}`);
    setUpdaterState({ status: "ready", error: message });
    toast.error(message, {
      id: UPDATE_TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
      action: {
        label: translate(msg`重试`),
        onClick: () => void restartToApplyUpdate(),
      },
    });
  }
}

function registerAvailableUpdate(update: Update) {
  if (activeUpdate && activeUpdate !== update) {
    void activeUpdate.close().catch(() => undefined);
  }

  activeUpdate = update;
  setUpdaterState({
    status: "available",
    version: update.version,
    releaseNotes: formatReleaseNotes(update.body),
    downloaded: 0,
    total: undefined,
    phase: "downloading",
    error: null,
  });
  showAvailableUpdateToast();
}

function showCheckingToast() {
  toast.loading(translate(msg`正在检查更新…`), {
    id: UPDATE_TOAST_ID,
    duration: Number.POSITIVE_INFINITY,
  });
}

function showAvailableUpdateToast() {
  const state = useUpdaterStore.getState();
  if (state.status !== "available" || !state.version) return;

  toast.info(translate(msg`发现新版本 ${state.version}`), {
    id: UPDATE_TOAST_ID,
    description: releaseNotesContent(state.releaseNotes),
    duration: Number.POSITIVE_INFINITY,
    closeButton: true,
    action: {
      label: translate(msg`下载更新`),
      onClick: () => void startUpdateDownload(),
    },
    cancel: {
      label: translate(msg`稍后`),
      onClick: discardAvailableUpdate,
    },
    onDismiss: () => {
      if (useUpdaterStore.getState().status === "available") {
        discardAvailableUpdate();
      }
    },
  });
}

function discardAvailableUpdate() {
  const update = activeUpdate;
  activeUpdate = null;
  resetUpdaterState();
  toast.dismiss(UPDATE_TOAST_ID);
  if (update) void update.close().catch(() => undefined);
}

async function startUpdateDownload() {
  if (downloadTask) {
    showDownloadProgressToast();
    return downloadTask;
  }

  const update = activeUpdate;
  if (!update) {
    resetUpdaterState();
    toast.error(translate(msg`更新信息已失效，请重新检查更新`), {
      id: UPDATE_TOAST_ID,
    });
    return;
  }

  setUpdaterState({
    status: "downloading",
    downloaded: 0,
    total: undefined,
    phase: "downloading",
    error: null,
  });
  showDownloadProgressToast();

  downloadTask = downloadAndInstall(update);
  try {
    await downloadTask;
  } finally {
    downloadTask = null;
  }
}

async function downloadAndInstall(update: Update) {
  try {
    await update.downloadAndInstall(handleDownloadEvent);

    const state = useUpdaterStore.getState();
    setUpdaterState({
      status: "ready",
      downloaded: state.total ?? state.downloaded,
      phase: "installing",
      error: null,
    });
    showReadyToRestartToast();
  } catch (error) {
    console.warn("update install failed", error);
    const message = translate(msg`更新失败：${formatError(error)}`);
    setUpdaterState({ status: "error", error: message });
    toast.error(message, {
      id: UPDATE_TOAST_ID,
      closeButton: true,
      action: {
        label: translate(msg`重新检查`),
        onClick: () => void resetAfterFailedUpdate(),
      },
    });
  } finally {
    activeUpdate = null;
    await update.close().catch(() => undefined);
  }
}

function handleDownloadEvent(event: DownloadEvent) {
  const state = useUpdaterStore.getState();

  if (event.event === "Started") {
    setUpdaterState({
      downloaded: 0,
      total: event.data.contentLength,
      phase: "downloading",
    });
  } else if (event.event === "Progress") {
    setUpdaterState({ downloaded: state.downloaded + event.data.chunkLength });
  } else {
    setUpdaterState({ phase: "installing" });
  }

  showDownloadProgressToast();
}

function showDownloadProgressToast() {
  const state = useUpdaterStore.getState();
  if (state.status !== "downloading" || !state.version) return;

  toast.loading(
    state.phase === "installing"
      ? translate(msg`正在准备版本 ${state.version}`)
      : translate(msg`正在下载版本 ${state.version}`),
    {
      id: UPDATE_TOAST_ID,
      description: downloadProgressContent(state),
      duration: Number.POSITIVE_INFINITY,
      closeButton: false,
      dismissible: false,
      action: null,
      cancel: null,
    },
  );
}

function showReadyToRestartToast() {
  const state = useUpdaterStore.getState();
  if (state.status !== "ready" || !state.version) return;

  toast.success(translate(msg`版本 ${state.version} 已准备好`), {
    id: UPDATE_TOAST_ID,
    description: translate(msg`重启应用即可完成更新。`),
    duration: Number.POSITIVE_INFINITY,
    closeButton: false,
    dismissible: true,
    action: {
      label: translate(msg`重启并更新`),
      onClick: () => void restartToApplyUpdate(),
    },
    cancel: {
      label: translate(msg`稍后`),
      onClick: () => toast.dismiss(UPDATE_TOAST_ID),
    },
  });
}

function showRestartingToast() {
  toast.loading(translate(msg`正在重启并应用更新…`), {
    id: UPDATE_TOAST_ID,
    duration: Number.POSITIVE_INFINITY,
    closeButton: false,
    dismissible: false,
    action: null,
    cancel: null,
  });
}

async function resetAfterFailedUpdate() {
  resetUpdaterState();
  await checkForUpdateManually();
}

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function checkWithTimeout() {
  return withTimeout(
    check({ timeout: UPDATE_CHECK_TIMEOUT_MS }),
    UPDATE_CHECK_TIMEOUT_MS,
    translate(msg`检查更新超时，请确认 GitHub Release 更新源是否可访问`),
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function releaseNotesContent(notes: string[]): ReactNode {
  if (notes.length === 0) return translate(msg`查看 GitHub Release 获取更新内容`);

  return createElement(
    "div",
    { className: "flex flex-col gap-1" },
    notes.map((note, index) =>
      createElement("div", { key: `${index}-${note}` }, note),
    ),
  );
}

function downloadProgressContent(state: ReturnType<typeof useUpdaterStore.getState>) {
  if (state.phase === "installing") return translate(msg`下载完成，正在安装更新…`);

  if (!state.total) return translate(msg`已下载 ${formatBytes(state.downloaded)}`);

  const percent = Math.min(
    100,
    Math.round((state.downloaded / state.total) * 100),
  );
  return translate(
    msg`${percent}%（${formatBytes(state.downloaded)} / ${formatBytes(state.total)}）`,
  );
}

export function formatReleaseNotes(body?: string) {
  if (!body?.trim()) return [];

  const notes: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    if (/^changes since\b/i.test(line)) continue;
    if (/^#{1,6}\s+/.test(line)) continue;
    if (/^(?:\*\*)?full changelog(?:\*\*)?:/i.test(line)) continue;
    if (/made their first contribution/i.test(line)) continue;

    line = line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "");

    // Only surface user-facing changes: feat / fix / perf commits.
    const typeMatch = /^(feat|fix|perf)(?:\([^)]*\))?!?:\s*/i.exec(line);
    if (!typeMatch) continue;

    line = line
      .slice(typeMatch[0].length)
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/\s+by\s+@\S+(?:\s+in\s+https?:\/\/\S+)?$/i, "")
      .replace(/\s+\(#[0-9]+\)$/, "")
      .replace(/\s+\([0-9a-f]{7,40}\)$/i, "")
      .trim();

    if (!line || notes.includes(line)) continue;
    notes.push(line);
    if (notes.length === MAX_RELEASE_NOTES) break;
  }

  return notes;
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function updateErrorTitle(error: unknown) {
  const message = formatError(error);
  if (message.includes("None of the fallback platforms")) {
    return translate(msg`检查更新失败：当前平台没有可用更新包`);
  }

  if (
    message.includes("error sending request") ||
    message.includes("timed out") ||
    message.includes("超时")
  ) {
    return translate(msg`检查更新失败：无法连接更新源`);
  }

  return translate(msg`检查更新失败：${message}`);
}
