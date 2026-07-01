import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";

let checkedOnLaunch = false;

export async function checkForUpdateOnLaunch() {
  if (checkedOnLaunch || !import.meta.env.PROD || !("__TAURI_INTERNALS__" in window)) {
    return;
  }

  checkedOnLaunch = true;

  try {
    const update = await check();
    if (!update) return;

    showUpdatePrompt(update);
  } catch (error) {
    console.warn("update check failed", error);
  }
}

function showUpdatePrompt(update: Update) {
  let updateStarted = false;
  let updateClosed = false;
  let toastId: string | number = "";
  const closeUpdate = () => {
    if (updateClosed) return;
    updateClosed = true;
    void update.close().catch(() => undefined);
  };

  toastId = toast.info(`发现新版本 ${update.version}`, {
    description: formatReleaseNotes(update.body),
    duration: Number.POSITIVE_INFINITY,
    closeButton: true,
    action: {
      label: "更新",
      onClick: () => {
        updateStarted = true;
        void downloadAndInstall(update, toastId);
      },
    },
    cancel: {
      label: "稍后",
      onClick: () => {
        closeUpdate();
        toast.dismiss(toastId);
      },
    },
    onDismiss: () => {
      if (!updateStarted) closeUpdate();
    },
  });
}

async function downloadAndInstall(update: Update, toastId: string | number) {
  let downloaded = 0;
  let total: number | undefined;

  try {
    toast.loading(`正在下载 ${update.version}`, {
      id: toastId,
      description: "准备下载",
      duration: Number.POSITIVE_INFINITY,
      closeButton: false,
      dismissible: false,
      action: null,
      cancel: null,
    });

    await update.downloadAndInstall((event) => {
      const description = progressDescription(event, {
        downloaded,
        total,
      });

      if (event.event === "Started") {
        downloaded = 0;
        total = event.data.contentLength;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
      }

      toast.loading(`正在下载 ${update.version}`, {
        id: toastId,
        description,
        duration: Number.POSITIVE_INFINITY,
        closeButton: false,
        dismissible: false,
        action: null,
        cancel: null,
      });
    });

    toast.success("更新完成，正在重启", {
      id: toastId,
      duration: Number.POSITIVE_INFINITY,
      closeButton: false,
      dismissible: false,
      action: null,
      cancel: null,
    });
    await relaunch();
  } catch (error) {
    console.warn("update install failed", error);
    toast.error("更新失败，请稍后重试", {
      id: toastId,
      closeButton: true,
    });
  } finally {
    await update.close().catch(() => undefined);
  }
}

function progressDescription(
  event: DownloadEvent,
  progress: { downloaded: number; total?: number },
) {
  if (event.event === "Started") {
    return "0%";
  }

  if (event.event === "Finished") {
    return "正在安装";
  }

  const downloaded = progress.downloaded + event.data.chunkLength;
  if (!progress.total) {
    return formatBytes(downloaded);
  }

  const percent = Math.min(100, Math.round((downloaded / progress.total) * 100));
  return `${percent}% (${formatBytes(downloaded)} / ${formatBytes(progress.total)})`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatReleaseNotes(body?: string) {
  const notes = body?.trim();
  if (!notes) return "查看 GitHub Release 获取更新内容";

  const lines = notes.split("\n").filter(Boolean);
  const visible = lines.slice(0, 8).join("\n");
  return lines.length > 8 ? `${visible}\n...` : visible;
}
