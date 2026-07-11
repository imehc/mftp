import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DirectoryTransferMode = "archive" | "direct";

interface SettingsState {
  directoryTransferMode: DirectoryTransferMode;
  sidebarSize: number;
  sidebarCollapsed: boolean;
  setDirectoryTransferMode: (mode: DirectoryTransferMode) => void;
  setSidebarSize: (size: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      directoryTransferMode: "archive",
      sidebarSize: 20,
      sidebarCollapsed: false,
      setDirectoryTransferMode: (mode) =>
        set({ directoryTransferMode: mode }),
      setSidebarSize: (size) => set({ sidebarSize: size }),
      setSidebarCollapsed: (collapsed) =>
        set({ sidebarCollapsed: collapsed }),
    }),
    {
      name: "mftp-settings",
    },
  ),
);
