import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DirectoryTransferMode = "archive" | "direct";

interface SettingsState {
  directoryTransferMode: DirectoryTransferMode;
  setDirectoryTransferMode: (mode: DirectoryTransferMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      directoryTransferMode: "archive",
      setDirectoryTransferMode: (mode) =>
        set({ directoryTransferMode: mode }),
    }),
    {
      name: "mftp-settings",
    },
  ),
);
