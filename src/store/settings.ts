import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  resolveColorTheme,
  resolveFontPreset,
  type ColorTheme,
  type FontPreset,
} from "~/lib/color-theme";

export type DirectoryTransferMode = "archive" | "direct";
/**
 * Single source of truth for tool routes. `migrate` re-validates the persisted
 * `lastTool` against this list, so a tool missing here silently loses
 * launch-time restore — keep it in sync when adding a route.
 */
export const TOOL_ROUTES = [
  "ssh-sftp",
  "lan-transfer",
  "crypto",
  "media-compress",
  "formatter",
  "vault",
  "library",
] as const;

export type ToolRoute = (typeof TOOL_ROUTES)[number];

const isToolRoute = (value: string): value is ToolRoute =>
  (TOOL_ROUTES as readonly string[]).includes(value);
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
      // v5: added the "library" tool route.
      version: 5,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        delete state.webBrowserDefaultUrl;
        const legacyTool =
          typeof state.lastTool === "string" ? state.lastTool : null;
        // The two compress tools merged into one route; everything else is
        // kept only if it still exists in TOOL_ROUTES.
        const lastTool: ToolRoute | null =
          legacyTool === "video-compress" || legacyTool === "image-compress"
            ? "media-compress"
            : legacyTool && isToolRoute(legacyTool)
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
