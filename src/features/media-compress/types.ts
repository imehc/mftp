export type CompressPhase =
  "idle" | "probing" | "compressing" | "done" | "error";

export type CompressModeId = "image" | "video" | "resize";

export interface CompressModeMeta {
  id: CompressModeId;
  /** 在 UI 中解析的 lucide 图标名 */
  icon: "image" | "video" | "resize";
}
