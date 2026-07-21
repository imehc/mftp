import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  resolveColorTheme,
  resolveFontPreset,
  type ColorTheme,
  type FontPreset,
} from "~/lib/color-theme";

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
  colorTheme: ColorTheme;
  fontPreset: FontPreset;
  setDirectoryTransferMode: (mode: DirectoryTransferMode) => void;
  setLocale: (locale: AppLocale) => void;
  setSidebarSize: (size: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setLastTool: (tool: ToolRoute | null) => void;
  setWebBrowserDefaultUrl: (url: string) => void;
  setColorTheme: (theme: ColorTheme) => void;
  setFontPreset: (font: FontPreset) => void;
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
      colorTheme: "default",
      fontPreset: "theme",
      setDirectoryTransferMode: (mode) =>
        set({ directoryTransferMode: mode }),
      setLocale: (locale) => set({ locale }),
      setSidebarSize: (size) => set({ sidebarSize: size }),
      setSidebarCollapsed: (collapsed) =>
        set({ sidebarCollapsed: collapsed }),
      setLastTool: (tool) => set({ lastTool: tool }),
      setWebBrowserDefaultUrl: (url) => set({ webBrowserDefaultUrl: url }),
      setColorTheme: (theme) => set({ colorTheme: theme }),
      setFontPreset: (font) => set({ fontPreset: font }),
    }),
    {
      name: "mftp-settings",
      version: 2,
      migrate: (persisted) => {
        const state = persisted as Partial<SettingsState> | undefined;
        return {
          ...state,
          colorTheme: resolveColorTheme(state?.colorTheme),
          fontPreset: resolveFontPreset(state?.fontPreset),
        } as SettingsState;
      },
    },
  ),
);
