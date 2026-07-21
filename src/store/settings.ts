import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DirectoryTransferMode = "archive" | "direct";
export type ToolRoute = "ssh-sftp" | "lan-transfer" | "crypto" | "web-browser";
export type AppLocale = "system" | "zh-CN" | "en";

interface SettingsState {
  directoryTransferMode: DirectoryTransferMode;
  locale: AppLocale;
  sidebarSize: number;
  sidebarCollapsed: boolean;
  lastTool: ToolRoute | null;
  webBrowserDefaultUrl: string;
  setDirectoryTransferMode: (mode: DirectoryTransferMode) => void;
  setLocale: (locale: AppLocale) => void;
  setSidebarSize: (size: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setLastTool: (tool: ToolRoute | null) => void;
  setWebBrowserDefaultUrl: (url: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      directoryTransferMode: "archive",
      locale: "system",
      sidebarSize: 20,
      sidebarCollapsed: false,
      lastTool: null,
      webBrowserDefaultUrl: "",
      setDirectoryTransferMode: (mode) =>
        set({ directoryTransferMode: mode }),
      setLocale: (locale) => set({ locale }),
      setSidebarSize: (size) => set({ sidebarSize: size }),
      setSidebarCollapsed: (collapsed) =>
        set({ sidebarCollapsed: collapsed }),
      setLastTool: (tool) => set({ lastTool: tool }),
      setWebBrowserDefaultUrl: (url) => set({ webBrowserDefaultUrl: url }),
    }),
    {
      name: "mftp-settings",
    },
  ),
);
