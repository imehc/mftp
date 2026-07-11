import { create } from "zustand";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "restarting"
  | "error";

export interface UpdaterState {
  status: UpdaterStatus;
  version: string | null;
  releaseNotes: string[];
  downloaded: number;
  total?: number;
  phase: "downloading" | "installing";
  error: string | null;
}

export const initialUpdaterState: UpdaterState = {
  status: "idle",
  version: null,
  releaseNotes: [],
  downloaded: 0,
  total: undefined,
  phase: "downloading",
  error: null,
};

export const useUpdaterStore = create<UpdaterState>(() => initialUpdaterState);

export function setUpdaterState(state: Partial<UpdaterState>) {
  useUpdaterStore.setState(state);
}

export function resetUpdaterState() {
  useUpdaterStore.setState(initialUpdaterState);
}
