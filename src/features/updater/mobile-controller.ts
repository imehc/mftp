import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { frontendError, toIpcError } from "~/lib/errors";
import { ANDROID_UPDATER_PROGRESS } from "~/lib/events";
import {
  androidUpdateCheck,
  androidUpdateDiscard,
  androidUpdateDownload,
  androidUpdateInstall,
  androidUpdateOpenInstallSettings,
} from "~/lib/ipc";
import { isAndroidPlatform } from "~/lib/platform";
import {
  initialUpdaterState,
  resetUpdaterState,
  setUpdaterState,
  useUpdaterStore,
} from "~/store/updater";

import { prepareReleaseNotes } from "./release-notes";

let checkedOnLaunch = false;
let checkTask: Promise<void> | null = null;
let downloadTask: Promise<void> | null = null;
let installTask: Promise<void> | null = null;
let progressUnlisten: UnlistenFn | null = null;
let updatePath: string | null = null;
let updateVersionCode: number | null = null;
let updateIdentity: string | null = null;
let updateInfo: Awaited<ReturnType<typeof androidUpdateCheck>> | null = null;

function supported() {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window &&
    isAndroidPlatform()
  );
}

function errorFor(
  error: unknown,
  code:
    | "updater:check_failed"
    | "updater:download_failed"
    | "updater:install_failed",
) {
  const payload = toIpcError(error).payload;
  if (
    ["frontend:error", "frontend:unknown", "legacy:raw"].includes(payload.code)
  )
    return frontendError(code, code);
  return payload;
}

export function openUpdaterDialog() {
  setUpdaterState({ dialogOpen: true });
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
  if (!supported()) return Promise.resolve();
  openUpdaterDialog();
  if (checkTask) return checkTask;
  if (downloadTask) return downloadTask;
  if (installTask) return installTask;
  return beginCheck(true);
}

function beginCheck(manual: boolean) {
  setUpdaterState({
    ...initialUpdaterState,
    status: "checking",
    dialogOpen: manual,
  });
  checkTask = performCheck(manual).finally(() => {
    checkTask = null;
  });
  return checkTask;
}

async function performCheck(manual: boolean) {
  try {
    const info = await androidUpdateCheck();
    updateInfo = info;
    if (!info.available) {
      updatePath = null;
      updateVersionCode = null;
      updateIdentity = null;
      setUpdaterState({
        status:
          manual || useUpdaterStore.getState().dialogOpen ? "current" : "idle",
        currentVersion: info.currentVersion,
      });
      return;
    }
    const identity = `${info.versionCode}:${info.sha256.toLowerCase()}`;
    if (updateIdentity !== identity) {
      const previousPath = updatePath;
      updatePath = null;
      updateVersionCode = info.versionCode;
      updateIdentity = identity;
      if (previousPath) void androidUpdateDiscard(previousPath);
    }
    const notes = prepareReleaseNotes(info.notes);
    setUpdaterState({
      status: updatePath ? "ready" : "available",
      version: info.version,
      currentVersion: info.currentVersion,
      releaseNotes: notes.text,
      notesTruncated: notes.truncated,
      total: info.size,
      downloaded: updatePath ? info.size : 0,
      error: null,
    });
  } catch (error) {
    if (manual || useUpdaterStore.getState().dialogOpen)
      setUpdaterState({
        status: "error",
        error: errorFor(error, "updater:check_failed"),
      });
    else resetUpdaterState();
  }
}

export function startUpdateDownload() {
  if (
    !supported() ||
    downloadTask ||
    useUpdaterStore.getState().status !== "available" ||
    !updateInfo?.available
  )
    return Promise.resolve();
  setUpdaterState({
    status: "downloading",
    phase: "connecting",
    connectionSlow: false,
    downloaded: 0,
    total: updateInfo.size,
    error: null,
  });
  downloadTask = download().finally(() => {
    downloadTask = null;
  });
  return downloadTask;
}

async function download() {
  let unlisten: UnlistenFn | null = null;
  try {
    unlisten = await listen<{
      phase: string;
      downloaded: number;
      total: number;
    }>(ANDROID_UPDATER_PROGRESS, (event) => {
      const payload = event.payload;
      setUpdaterState({
        phase:
          payload.phase === "verifying"
            ? "verifying"
            : payload.phase === "downloading"
              ? "downloading"
              : "connecting",
        downloaded: payload.downloaded,
        total: payload.total,
        connectionSlow: false,
      });
    });
    progressUnlisten = unlisten;
    const result = await androidUpdateDownload({
      url: updateInfo!.url,
      size: updateInfo!.size,
      sha256: updateInfo!.sha256,
      versionCode: updateInfo!.versionCode,
    });
    updatePath = result.path;
    updateVersionCode = result.versionCode;
    updateIdentity = `${result.versionCode}:${updateInfo!.sha256.toLowerCase()}`;
    setUpdaterState({
      status: "ready",
      phase: "verifying",
      downloaded: result.downloaded,
      total: result.total,
      error: null,
    });
  } catch (error) {
    updatePath = null;
    setUpdaterState({
      status: "error",
      error: errorFor(error, "updater:download_failed"),
    });
  } finally {
    if (unlisten) unlisten();
    if (progressUnlisten === unlisten) progressUnlisten = null;
  }
}

export function restartToApplyUpdate() {
  if (
    !supported() ||
    installTask ||
    useUpdaterStore.getState().status !== "ready" ||
    !updatePath ||
    !updateVersionCode
  )
    return Promise.resolve();
  setUpdaterState({ status: "restarting", error: null });
  installTask = install().finally(() => {
    installTask = null;
  });
  return installTask;
}

async function install() {
  try {
    const result = await androidUpdateInstall(updatePath!, updateVersionCode!);
    if (result.outcome === "permission_required") {
      await androidUpdateOpenInstallSettings();
      setUpdaterState({
        status: "ready",
        error: frontendError(
          "updater:install_failed",
          "Android install permission is required",
        ),
      });
      return;
    }
    if (result.outcome === "cancelled") {
      setUpdaterState({ status: "ready", error: null });
      return;
    }
    if (result.outcome !== "installed") {
      setUpdaterState({
        status: "ready",
        error: frontendError(
          "updater:install_failed",
          "Android update installation did not complete",
        ),
      });
      return;
    }
    updatePath = null;
    setUpdaterState({ installed: true, status: "restarting", error: null });
  } catch (error) {
    setUpdaterState({
      status: "ready",
      error: errorFor(error, "updater:install_failed"),
    });
  }
}
