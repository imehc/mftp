import type { AnimationClip, Group } from "three";

export type ImportProgress = {
  phase: "reading" | "decoding" | "uploading";
  name?: string;
  loaded?: number;
  total?: number;
};

export interface ModelSource {
  name: string;
  size: number;
  sizeOf(key: string): Promise<number | null>;
  read(
    key: string,
    signal: AbortSignal,
    progress: (loaded: number, total: number) => void,
  ): Promise<Uint8Array<ArrayBuffer>>;
  attach(key: string, file: File | string): Promise<void>;
  close(): Promise<void>;
}

export interface ModelHandle {
  name: string;
  format: string;
  size: number;
  scene: Group;
  resourceScenes?: Group[];
  animations: AnimationClip[];
  hasGeometry: boolean;
  validationSource?: import("../inspection/types").ValidationSource;
  // 可入库原始资源使用已规范化的相对键；预览和 glTF 规范验证是独立能力。
  archive?: Map<string, Blob>;
  dispose(): void;
}
