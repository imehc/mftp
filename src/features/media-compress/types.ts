export type CompressPhase =
  | "idle"
  | "probing"
  | "compressing"
  | "done"
  | "error";

export type CompressModeId = "image" | "video";

export interface CompressModeMeta {
  id: CompressModeId;
  /** lucide icon name resolved in UI */
  icon: "image" | "video";
}
