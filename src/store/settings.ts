import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  resolveColorTheme,
  resolveFontPreset,
  type ColorTheme,
  type FontPreset,
} from "~/lib/color-theme";

export type DirectoryTransferMode = "archive" | "direct";
export type ToolRoute =
  | "ssh-sftp"
  | "lan-transfer"
  | "crypto"
  | "media-compress"
  | "formatter";
export type AppLocale = "system" | "zh-CN" | "en";

interface SettingsState {
  directoryTransferMode: DirectoryTransferMode;
  locale: AppLocale;
  sidebarSize: number;
  sidebarCollapsed: boolean;
  lastTool: ToolRoute | null;
  colorTheme: ColorTheme;
  fontPreset: FontPreset;
  /** Home page games section is collapsed by default. */
  showGames: boolean;
  /** Master volume for game sound effects, 0..1. */
  gamesVolume: number;
  setDirectoryTransferMode: (mode: DirectoryTransferMode) => void;
  setLocale: (locale: AppLocale) => void;
  setSidebarSize: (size: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setLastTool: (tool: ToolRoute | null) => void;
  setColorTheme: (theme: ColorTheme) => void;
  setFontPreset: (font: FontPreset) => void;
  setShowGames: (show: boolean) => void;
  setGamesVolume: (volume: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      directoryTransferMode: "archive",
      locale: "system",
      sidebarSize: 20,
      sidebarCollapsed: false,
      lastTool: null,
      colorTheme: "default",
      fontPreset: "theme",
      showGames: false,
      gamesVolume: 0.7,
      setDirectoryTransferMode: (mode) =>
        set({ directoryTransferMode: mode }),
      setLocale: (locale) => set({ locale }),
      setSidebarSize: (size) => set({ sidebarSize: size }),
      setSidebarCollapsed: (collapsed) =>
        set({ sidebarCollapsed: collapsed }),
      setLastTool: (tool) => set({ lastTool: tool }),
      setColorTheme: (theme) => set({ colorTheme: theme }),
      setFontPreset: (font) => set({ fontPreset: font }),
      setShowGames: (show) => set({ showGames: show }),
      setGamesVolume: (gamesVolume) => set({ gamesVolume }),
    }),
    {
      name: "mftp-settings",
      version: 4,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        delete state.webBrowserDefaultUrl;
        const legacyTool =
          typeof state.lastTool === "string" ? state.lastTool : null;
        const lastTool: ToolRoute | null =
          legacyTool === "video-compress" || legacyTool === "image-compress"
            ? "media-compress"
            : legacyTool === "ssh-sftp" ||
                legacyTool === "lan-transfer" ||
                legacyTool === "crypto" ||
                legacyTool === "media-compress" ||
                legacyTool === "formatter"
              ? legacyTool
              : null;
        return {
          ...state,
          lastTool,
          colorTheme: resolveColorTheme(state.colorTheme),
          fontPreset: resolveFontPreset(state.fontPreset),
        } as SettingsState;
      },
    },
  ),
);
