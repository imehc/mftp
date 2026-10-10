import { create } from "zustand";

import type { AppError } from "~/types";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "restarting"
  | "error";

export interface UpdaterState {
  status: UpdaterStatus;
  dialogOpen: boolean;
  bannerDismissed: boolean;
  version: string | null;
  currentVersion: string | null;
  releaseNotes: string;
  notesTruncated: boolean;
  downloaded: number;
  total?: number;
  phase: "connecting" | "downloading" | "verifying";
  connectionSlow: boolean;
  installed: boolean;
  /** 更新插件的完整错误（external），到渲染时再本地化。 */
  error: AppError | null;
}

export const initialUpdaterState: UpdaterState = {
  status: "idle",
  dialogOpen: false,
  bannerDismissed: false,
  version: null,
  currentVersion: null,
  releaseNotes: "",
  notesTruncated: false,
  downloaded: 0,
  total: undefined,
  phase: "connecting",
  connectionSlow: false,
  installed: false,
  error: null,
};

export const useUpdaterStore = create<UpdaterState>(() => initialUpdaterState);

export function setUpdaterState(state: Partial<UpdaterState>) {
  useUpdaterStore.setState(state);
}

export function resetUpdaterState() {
  useUpdaterStore.setState(initialUpdaterState);
}
