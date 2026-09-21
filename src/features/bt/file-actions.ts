import { downloadDir } from "@tauri-apps/api/path";

/** 系统下载目录，解析一次后复用（进程内不会变）。解析失败时返回空串，
 * 调用方据此退回“未指定”，而不是让添加流程挂在这里。 */
let downloadDirOnce: Promise<string> | null = null;
export function systemDownloadDir() {
  downloadDirOnce ??= downloadDir().catch(() => "");
  return downloadDirOnce;
}
