import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { downloadDir } from "@tauri-apps/api/path";
import * as ipc from "~/lib/ipc";
import { previewKind } from "~/lib/preview-kind";
import type { BtFileMeta } from "~/types";

/** 系统下载目录，解析一次后复用（进程内不会变）。解析失败时返回空串，
 * 调用方据此退回“未指定”，而不是让添加流程挂在这里。 */
let downloadDirOnce: Promise<string> | null = null;
export function systemDownloadDir() {
  downloadDirOnce ??= downloadDir().catch(() => "");
  return downloadDirOnce;
}

/** 预览页的深链接参数：只要 infohash + 文件序号，后端就能给出播放地址，
 * 因此缓存条目与任务行都能直接跳过去（未下完也能边下边看）。 */
export function previewSearch(infoHash: string, file: BtFileMeta) {
  return {
    name: file.path.split("/").pop() ?? file.path,
    kind: previewKind(file.path),
    hash: infoHash,
    index: file.index,
  };
}

/** 选目录并转存到本地；返回是否已提交（用户放弃选目录时为 false）。
 * 成功与失败都由 BT_TASK_EVENT 的 saved / save-failed 通知。 */
export async function saveFileToLocal(infoHash: string, fileIndex: number) {
  const picked = await openDialog({
    multiple: false,
    directory: true,
    defaultPath: (await systemDownloadDir()) || undefined,
  });
  if (typeof picked !== "string") return false;
  await ipc.btSaveToLocal(infoHash, picked, fileIndex);
  return true;
}
