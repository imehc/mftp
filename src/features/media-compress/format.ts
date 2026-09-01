import { isMobilePlatform } from "~/lib/platform";

// 重新导出，使本模块的既有调用方仍可正常工作。
export { formatBytes } from "~/lib/format";

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function baseName(pathOrName: string): string {
  const parts = pathOrName.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? pathOrName;
}

export function stripExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/** 浏览器兜底：用 <a download>（普通浏览器可用，WebView 里未必）。 */
function downloadBlobInBrowser(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * 将 blob 保存到磁盘。在 Tauri 中打开原生保存对话框并写入字节
 *（WebView 常忽略 HTML 的 download 属性）。
 * 返回实际写入磁盘的字节数；用户取消则返回 false。
 */
export async function downloadBlob(
  blob: Blob,
  fileName: string,
): Promise<number | false> {
  if (!isTauriRuntime()) {
    downloadBlobInBrowser(blob, fileName);
    return blob.size;
  }

  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile, stat } = await import("@tauri-apps/plugin-fs");

  const target = await save({
    defaultPath: fileName,
    title: fileName,
  });
  if (typeof target !== "string" || !target) {
    return false;
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFile(target, bytes);

  // 读回实际磁盘占用（文件系统块对齐可能不同）。
  try {
    const info = await stat(target);
    return info.size;
  } catch {
    return bytes.length;
  }
}

/** 正数表示比原文件小；负数表示更大；未知为 null。 */
export function sizeDeltaPercent(
  originalBytes: number,
  resultBytes: number,
): number | null {
  if (
    !Number.isFinite(originalBytes) ||
    !Number.isFinite(resultBytes) ||
    originalBytes <= 0
  ) {
    return null;
  }
  return Math.round(((originalBytes - resultBytes) / originalBytes) * 100);
}

const PICKED_FILE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
};

export interface NativeFilePickOptions {
  title?: string;
  /** 原生对话框中显示的文件类型标签。 */
  filterName: string;
  /** 允许的后缀（不含点），如 ["png", "jpg"]。 */
  extensions: string[];
}

/**
 * 用原生对话框选择单个文件，并强制后缀过滤。桌面端 WebView
 *（尤其是 WKWebView）会忽略 HTML 的 accept 属性，导致隐藏的
 * <input type="file"> 能选任意文件。原生选择器不可用时（浏览器 / 移动端，
 * 其系统选择器会遵守 accept）返回 null —— 调用方应回退到 input 元素；
 * 用户取消对话框时返回 false。
 */
export async function pickFileNative(
  options: NativeFilePickOptions,
): Promise<File | null | false> {
  if (!isTauriRuntime() || isMobilePlatform()) return null;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    title: options.title,
    filters: [{ name: options.filterName, extensions: options.extensions }],
  });
  if (typeof selected !== "string" || !selected) return false;

  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(selected);
  const name = baseName(selected);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return new File([bytes], name, { type: PICKED_FILE_MIME[ext] ?? "" });
}
