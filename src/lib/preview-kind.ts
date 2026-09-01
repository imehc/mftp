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

/** WebView 自己能解码的容器。macOS 的 WKWebView 与 Windows 的 WebView2 都
 * 只认这几种：mkv / avi / wmv / flv / ts 无论内部编码如何都放不出来，因此
 * 这类文件直接给出「用外部播放器打开」的提示，而不是转半天再报错。 */
const INLINE_VIDEO = new Set(["mp4", "m4v", "mov", "webm"]);
const INLINE_AUDIO = new Set([
  "mp3",
  "m4a",
  "aac",
  "wav",
  "flac",
  "ogg",
  "opus",
]);

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

/** 视频 / 音频能否直接在 WebView 里播放；其它类型一律 true（与播放无关）。 */
export function canPlayInline(path: string, kind: PreviewKind): boolean {
  const ext = extensionOf(path);
  if (kind === "video") return INLINE_VIDEO.has(ext);
  if (kind === "audio") return INLINE_AUDIO.has(ext);
  return true;
}

/** 把一个不可信的值（URL 查询参数）收敛回预览类型。 */
export function toPreviewKind(value: unknown): PreviewKind | undefined {
  return PREVIEW_KINDS.find((kind) => kind === value);
}
