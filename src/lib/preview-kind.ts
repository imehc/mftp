/**
 * 扩展名 -> 预览类型。所有需要预览文件的模块共用
 *（BT 流、SFTP、本地选择器），因此放在 lib 而非某个 feature 文件夹中。
 */

export type PreviewKind = "video" | "audio" | "image" | "text" | "other";

const VIDEO = new Set([
  "mp4",
  "m4v",
  "mkv",
  "mov",
  "webm",
  "avi",
  "wmv",
  "flv",
  "ts",
  "m2ts",
]);
const AUDIO = new Set([
  "mp3",
  "flac",
  "aac",
  "ogg",
  "wav",
  "m4a",
  "opus",
  "wma",
]);
const IMAGE = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "avif",
  "svg",
]);
const TEXT = new Set([
  "txt",
  "md",
  "log",
  "json",
  "xml",
  "yml",
  "yaml",
  "toml",
  "ini",
  "conf",
  "csv",
  "nfo",
  "srt",
  "ass",
  "vtt",
]);

const PREVIEW_KINDS: readonly PreviewKind[] = [
  "video",
  "audio",
  "image",
  "text",
];

export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function previewKind(path: string): PreviewKind {
  const ext = extensionOf(path);
  if (VIDEO.has(ext)) return "video";
  if (AUDIO.has(ext)) return "audio";
  if (IMAGE.has(ext)) return "image";
  if (TEXT.has(ext)) return "text";
  return "other";
}

export function isPreviewable(kind: PreviewKind): boolean {
  return kind !== "other";
}

/** 把一个不可信的值（URL 查询参数）收敛回预览类型。 */
export function toPreviewKind(value: unknown): PreviewKind | undefined {
  return PREVIEW_KINDS.find((kind) => kind === value);
}
