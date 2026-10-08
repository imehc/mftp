import { isMobilePlatform } from "~/lib/platform";

/**
 * 通用文件选择 / 保存与路径纯工具。
 *
 * 这些能力原先放在媒体压缩模块内（`features/media-compress/format.ts`），
 * 导出（备份）等无关功能不得不反向依赖媒体内部实现；路径切分也在 SFTP 里
 * 各写了一份。这里作为跨 feature 的公共入口，只依赖平台判断与 Tauri 插件。
 */

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/** 取路径最后一段（同时兼容 Windows 与 POSIX 分隔符）。 */
export function baseName(pathOrName: string): string {
  const parts = pathOrName.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? pathOrName;
}

export function stripExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx > 0 ? fileName.slice(0, idx) : fileName;
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
  /** 调用方既有后端支持原生路径时，可保留移动系统文件选择流程。 */
  allowMobile?: boolean;
  /** 原生对话框中显示的文件类型标签。 */
  filterName: string;
  /** 允许的后缀（不含点），如 ["png", "jpg"]；["*"] 表示所有文件。 */
  extensions: string[];
}

function nativeFileFilters(options: NativeFilePickOptions) {
  // macOS 会把星号当作实际后缀；选择所有文件时必须省略原生类型过滤。
  return options.extensions.includes("*")
    ? undefined
    : [{ name: options.filterName, extensions: options.extensions }];
}

/**
 * 用原生对话框选择单个文件，并强制后缀过滤。桌面端 WebView
 *（尤其是 WKWebView）会忽略 HTML 的 accept 属性，导致隐藏的
 * <input type="file"> 能选任意文件。原生选择器不可用时（浏览器 / 移动端，
 * 其系统选择器会遵守 accept）返回 null —— 调用方应回退到 input 元素；
 * 用户取消对话框时返回 false。
 */
export async function pickFilePathNative(
  options: NativeFilePickOptions,
): Promise<string | null | false> {
  if (!isTauriRuntime() || (isMobilePlatform() && !options.allowMobile))
    return null;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    title: options.title,
    filters: nativeFileFilters(options),
  });
  if (typeof selected !== "string" || !selected) return false;

  return selected;
}

/** 原生多选只返回授权路径，不提前读取文件内容。 */
export async function pickFilePathsNative(
  options: NativeFilePickOptions,
): Promise<string[] | null> {
  if (!isTauriRuntime() || (isMobilePlatform() && !options.allowMobile))
    return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: true,
    directory: false,
    title: options.title,
    filters: nativeFileFilters(options),
  });
  return Array.isArray(selected)
    ? selected
    : typeof selected === "string"
      ? [selected]
      : [];
}

/** 读取小文件为浏览器 File；大文件交给后端时使用路径入口，避免整包载入前端内存。 */
export async function pickFileNative(
  options: NativeFilePickOptions,
): Promise<File | null | false> {
  const selected = await pickFilePathNative(options);
  if (typeof selected !== "string") return selected;

  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(selected);
  const name = baseName(selected);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return new File([bytes], name, { type: PICKED_FILE_MIME[ext] ?? "" });
}

/** 目录选择在桌面原生对话框完成；取消不改变调用方已有路径。 */
export async function pickDirectoryNative(
  title: string,
): Promise<string | null> {
  if (!isTauriRuntime() || isMobilePlatform()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ title, directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}
