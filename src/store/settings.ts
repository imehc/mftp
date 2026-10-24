import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { DirectoryTransferMode as SftpDirectoryTransferMode } from "~/bindings";
import {
  type CjkFont,
  type ColorTheme,
  resolveCjkFont,
  resolveColorTheme,
} from "~/lib/color-theme";
import { type DisplaySize, resolveDisplaySize } from "~/lib/display-size";
import {
  isModuleId,
  moduleForTool,
  type ModuleId,
  TOOL_ROUTES,
  type ToolRoute,
} from "~/lib/module-metadata";

/** 目录传输偏好包含后端 sftp 命令不接受的 rsync，调用 IPC 前必须显式分支。 */
export type DirectoryTransferMode = SftpDirectoryTransferMode | "rsync";

/**
 * 工具路由的唯一权威来源是 `~/lib/module-metadata`。`migrate` 依据
 * TOOL_ROUTES 重新校验已持久化的 `lastTool`，因此新增入口要登记模块元数据，
 * 不要在这里另加白名单。
 */
export type { ToolRoute };

const isToolRoute = (value: string): value is ToolRoute =>
  (TOOL_ROUTES as readonly string[]).includes(value);

export type AppLocale = "system" | "zh-CN" | "en";

export type HomeCategoryId = "tools" | "library" | "games";

export type HomeEntryOrder = Partial<Record<HomeCategoryId, string[]>>;

export type HomeEntryVisibility = Record<string, boolean>;

export type StartupMode = "home" | "manual" | "last";

function resolveHomeEntryOrder(value: unknown): HomeEntryOrder {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: HomeEntryOrder = {};
  for (const category of ["tools", "library", "games"] as const) {
    const order = source[category];
    if (Array.isArray(order) && order.every((id) => typeof id === "string"))
      result[category] = [...new Set(order)];
  }
  return result;
}

interface SettingsState {
  directoryTransferMode: DirectoryTransferMode;
  /** rsync 专属：删除目标目录中源目录不存在的文件。 */
  rsyncDeleteExtraneous: boolean;
  locale: AppLocale;
  sidebarSize: number;
  sidebarCollapsed: boolean;
  lastTool: ToolRoute | null;
  lastPage: ModuleId | null;
  startupMode: StartupMode;
  manualPage: ModuleId | null;
  restoreLastTool: boolean;
  colorTheme: ColorTheme;
  cjkFont: CjkFont;
  displaySize: DisplaySize;
  /** 首页游戏区默认折叠。 */
  showGames: boolean;
  /** 游戏音效主音量，取值范围 0..1。 */
  gamesVolume: number;
  homeEntryOrder: HomeEntryOrder;
  homeEntryVisibility: HomeEntryVisibility;
  hiddenHomeCategories: HomeCategoryId[];
  setDirectoryTransferMode: (mode: DirectoryTransferMode) => void;
  setRsyncDeleteExtraneous: (value: boolean) => void;
  setLocale: (locale: AppLocale) => void;
  setSidebarSize: (size: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setLastTool: (tool: ToolRoute | null) => void;
  setLastPage: (page: ModuleId | null) => void;
  setStartupMode: (mode: StartupMode) => void;
  setManualPage: (page: ModuleId | null) => void;
  setRestoreLastTool: (restore: boolean) => void;
  setColorTheme: (theme: ColorTheme) => void;
  setCjkFont: (font: CjkFont) => void;
  setDisplaySize: (value: DisplaySize) => void;
  setShowGames: (show: boolean) => void;
  setGamesVolume: (volume: number) => void;
  setHomeEntryOrder: (category: HomeCategoryId, order: string[]) => void;
  setHomeEntryVisible: (id: string, visible: boolean) => void;
  setHomeCategoryVisible: (category: HomeCategoryId, visible: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      directoryTransferMode: "archive",
      rsyncDeleteExtraneous: false,
      locale: "system",
      sidebarSize: 20,
      sidebarCollapsed: false,
      lastTool: null,
      lastPage: null,
      startupMode: "last",
      manualPage: null,
      restoreLastTool: true,
      colorTheme: "default",
      cjkFont: "system",
      displaySize: { mode: "system", scale: 1 },
      showGames: false,
      gamesVolume: 0.7,
      homeEntryOrder: {},
      homeEntryVisibility: {},
      hiddenHomeCategories: ["games"],
      setDirectoryTransferMode: (mode) => set({ directoryTransferMode: mode }),
      setRsyncDeleteExtraneous: (rsyncDeleteExtraneous) =>
        set({ rsyncDeleteExtraneous }),
      setLocale: (locale) => set({ locale }),
      setSidebarSize: (size) => set({ sidebarSize: size }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setLastTool: (tool) =>
        set({
          lastTool: tool,
          lastPage: tool ? (moduleForTool(tool)?.id ?? null) : null,
        }),
      setLastPage: (page) => set({ lastPage: page }),
      setStartupMode: (startupMode) =>
        set({ startupMode, restoreLastTool: startupMode === "last" }),
      setManualPage: (manualPage) => set({ manualPage }),
      setRestoreLastTool: (restoreLastTool) =>
        set({
          restoreLastTool,
          startupMode: restoreLastTool ? "last" : "home",
        }),
      setColorTheme: (theme) => set({ colorTheme: theme }),
      setCjkFont: (font) => set({ cjkFont: font }),
      setDisplaySize: (value) =>
        set({ displaySize: resolveDisplaySize(value) }),
      setShowGames: (show) =>
        set((state) => ({
          showGames: show,
          hiddenHomeCategories: show
            ? state.hiddenHomeCategories.filter((item) => item !== "games")
            : [...new Set([...state.hiddenHomeCategories, "games" as const])],
        })),
      setGamesVolume: (gamesVolume) => set({ gamesVolume }),
      setHomeEntryOrder: (category, order) =>
        set((state) => ({
          homeEntryOrder: { ...state.homeEntryOrder, [category]: order },
        })),
      setHomeEntryVisible: (id, visible) =>
        set((state) => ({
          homeEntryVisibility: { ...state.homeEntryVisibility, [id]: visible },
        })),
      setHomeCategoryVisible: (category, visible) =>
        set((state) => ({
          hiddenHomeCategories: visible
            ? state.hiddenHomeCategories.filter((item) => item !== category)
            : [...new Set([...state.hiddenHomeCategories, category])],
          ...(category === "games" ? { showGames: visible } : {}),
        })),
    }),
    {
      name: "mftp-settings",
      // v10：增加 rsync 目录同步方式与删除策略。
      version: 10,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        delete state.webBrowserDefaultUrl;
        // 纯西文字体预设已废弃：字体选项改为只提供含中文字形的预设。
        delete state.fontPreset;
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
          directoryTransferMode:
            state.directoryTransferMode === "archive" ||
            state.directoryTransferMode === "direct" ||
            state.directoryTransferMode === "rsync"
              ? state.directoryTransferMode
              : "archive",
          rsyncDeleteExtraneous:
            typeof state.rsyncDeleteExtraneous === "boolean"
              ? state.rsyncDeleteExtraneous
              : false,
          lastTool,
          lastPage:
            "lastPage" in state
              ? isModuleId(state.lastPage)
                ? state.lastPage
                : null
              : lastTool
                ? (moduleForTool(lastTool)?.id ?? null)
                : null,
          startupMode:
            state.startupMode === "home" ||
            state.startupMode === "manual" ||
            state.startupMode === "last"
              ? state.startupMode
              : state.restoreLastTool === false
                ? "home"
                : "last",
          manualPage: isModuleId(state.manualPage) ? state.manualPage : null,
          restoreLastTool:
            typeof state.restoreLastTool === "boolean"
              ? state.restoreLastTool
              : true,
          colorTheme: resolveColorTheme(state.colorTheme),
          cjkFont: resolveCjkFont(state.cjkFont),
          displaySize: resolveDisplaySize(state.displaySize),
          homeEntryOrder: resolveHomeEntryOrder(state.homeEntryOrder),
          homeEntryVisibility:
            state.homeEntryVisibility &&
            typeof state.homeEntryVisibility === "object"
              ? state.homeEntryVisibility
              : {},
          hiddenHomeCategories: Array.isArray(state.hiddenHomeCategories)
            ? state.hiddenHomeCategories.filter(
                (item): item is HomeCategoryId =>
                  item === "tools" || item === "library" || item === "games",
              )
            : state.showGames === false
              ? ["games"]
              : [],
        } as SettingsState;
      },
    },
  ),
);
