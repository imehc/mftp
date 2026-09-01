import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PoetryCollectionStatus, PoetrySearchScope } from "~/types";

interface PoetryState {
  /** 来自 `poetry_collections()` 的已安装合集缓存镜像。 */
  collections: PoetryCollectionStatus[];
  setCollections: (collections: PoetryCollectionStatus[]) => void;

  /** 列表 / 详情视图所筛选到的合集 id；为空表示全部。 */
  activeCollectionIds: string[];
  toggleCollection: (id: string) => void;
  clearCollectionFilter: () => void;

  /** 搜索范围 + 本地持久化的历史（最新在前）。 */
  searchScope: PoetrySearchScope;
  setSearchScope: (scope: PoetrySearchScope) => void;
  searchHistory: string[];
  pushSearchHistory: (query: string) => void;
  clearSearchHistory: () => void;

  /** 详情面板的阅读偏好。 */
  fontSize: number;
  lineHeight: number;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
}

const MAX_HISTORY = 12;

export const usePoetryStore = create<PoetryState>()(
  persist(
    (set) => ({
      collections: [],
      setCollections: (collections) => set({ collections }),

      activeCollectionIds: [],
      toggleCollection: (id) =>
        set((state) => ({
          activeCollectionIds: state.activeCollectionIds.includes(id)
            ? state.activeCollectionIds.filter((active) => active !== id)
            : [...state.activeCollectionIds, id],
        })),
      clearCollectionFilter: () => set({ activeCollectionIds: [] }),

      searchScope: "all",
      setSearchScope: (searchScope) => set({ searchScope }),
      searchHistory: [],
      pushSearchHistory: (query) =>
        set((state) => {
          const trimmed = query.trim();
          if (!trimmed) return state;
          return {
            searchHistory: [
              trimmed,
              ...state.searchHistory.filter((item) => item !== trimmed),
            ].slice(0, MAX_HISTORY),
          };
        }),
      clearSearchHistory: () => set({ searchHistory: [] }),

      fontSize: 17,
      lineHeight: 1.9,
      setFontSize: (fontSize) => set({ fontSize }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
    }),
    {
      name: "mftp-poetry",
      version: 1,
      partialize: (state) => ({
        // 合集是运行时缓存；只持久化用户偏好。
        activeCollectionIds: state.activeCollectionIds,
        searchScope: state.searchScope,
        searchHistory: state.searchHistory,
        fontSize: state.fontSize,
        lineHeight: state.lineHeight,
      }),
    },
  ),
);
