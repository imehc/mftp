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
 * 工具路由的唯一权威来源。`migrate` 会依据此列表重新校验已持久化的
 * `lastTool`，因此若在此漏掉某个工具，启动时的恢复会静默失效——
 * 新增路由时务必保持同步。
 */
export const TOOL_ROUTES = [
  "ssh-sftp",
  "lan-transfer",
  "crypto",
  "media-compress",
  "formatter",
  "vault",
  "library",
  "bt",
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
  /** 首页游戏区默认折叠。 */
  showGames: boolean;
  /** 游戏音效主音量，取值范围 0..1。 */
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
      setDirectoryTransferMode: (mode) => set({ directoryTransferMode: mode }),
      setLocale: (locale) => set({ locale }),
      setSidebarSize: (size) => set({ sidebarSize: size }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setLastTool: (tool) => set({ lastTool: tool }),
      setColorTheme: (theme) => set({ colorTheme: theme }),
      setFontPreset: (font) => set({ fontPreset: font }),
      setShowGames: (show) => set({ showGames: show }),
      setGamesVolume: (gamesVolume) => set({ gamesVolume }),
    }),
    {
      name: "mftp-settings",
      // v5：新增了 "library" 工具路由。
      version: 5,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        delete state.webBrowserDefaultUrl;
        const legacyTool =
          typeof state.lastTool === "string" ? state.lastTool : null;
        // 两个压缩工具已合并为同一个路由；其余工具只有在
        // TOOL_ROUTES 中仍然存在时才会保留。
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
