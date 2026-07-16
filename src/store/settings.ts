import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DirectoryTransferMode = "archive" | "direct";
export type ToolRoute = "ssh-sftp" | "lan-transfer";

interface SettingsState {
  directoryTransferMode: DirectoryTransferMode;
  sidebarSize: number;
  sidebarCollapsed: boolean;
  lastTool: ToolRoute | null;
  setDirectoryTransferMode: (mode: DirectoryTransferMode) => void;
  setSidebarSize: (size: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setLastTool: (tool: ToolRoute | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      directoryTransferMode: "archive",
      sidebarSize: 20,
      sidebarCollapsed: false,
      lastTool: null,
      setDirectoryTransferMode: (mode) =>
        set({ directoryTransferMode: mode }),
      setSidebarSize: (size) => set({ sidebarSize: size }),
      setSidebarCollapsed: (collapsed) =>
        set({ sidebarCollapsed: collapsed }),
      setLastTool: (tool) => set({ lastTool: tool }),
    }),
    {
      name: "mftp-settings",
    },
  ),
);
