import type {
  CompressModeId,
  CompressModeMeta,
} from "~/features/media-compress/types";

/** 压缩模式注册表 —— 新增格式（音频、PDF 等）时在此追加。 */
export const COMPRESS_MODES: readonly CompressModeMeta[] = [
  { id: "resize", icon: "resize" },
  { id: "image", icon: "image" },
  { id: "video", icon: "video" },
] as const;

export const DEFAULT_COMPRESS_MODE: CompressModeId = "image";

export function isCompressModeId(value: unknown): value is CompressModeId {
  return value === "image" || value === "video" || value === "resize";
}

export function resolveCompressMode(value: unknown): CompressModeId {
  return isCompressModeId(value) ? value : DEFAULT_COMPRESS_MODE;
}
