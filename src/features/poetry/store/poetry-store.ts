import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { PoetrySearchScope } from "~/types";

import {
  type PoetryReadingView,
  type PoetryReferenceView,
  resolvePoetryReadingView,
  resolvePoetryReferenceView,
} from "../reading-view";

interface PoetryState {
  /** 列表 / 详情视图所筛选到的合集 id；为空表示全部。 */
  activeCollectionIds: string[];
  toggleCollection: (id: string) => void;
  clearCollectionFilter: () => void;

  /** 搜索范围 + 本地持久化的历史（最新在前）。 */
  searchScope: PoetrySearchScope;
  setSearchScope: (scope: PoetrySearchScope) => void;
  searchHistory: string[];
  pushSearchHistory: (query: string) => void;
  removeSearchHistory: (query: string) => void;
  clearSearchHistory: () => void;

  /** 详情面板的阅读偏好。 */
  readingView: PoetryReadingView;
  referenceView: PoetryReferenceView;
  setReadingView: (view: PoetryReadingView) => void;
  fontSize: number;
  lineHeight: number;
  speechVoiceId: string | null;
  speechRate: number;
  setSpeechVoiceId: (id: string) => void;
  setSpeechRate: (rate: number) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
}

const MAX_HISTORY = 12;

export const usePoetryStore = create<PoetryState>()(
  persist(
    (set) => ({
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
      removeSearchHistory: (query) =>
        set((state) => ({
          searchHistory: state.searchHistory.filter((item) => item !== query),
        })),
      clearSearchHistory: () => set({ searchHistory: [] }),

      readingView: "original",
      referenceView: "translation",
      setReadingView: (readingView) =>
        set((state) => ({
          readingView,
          referenceView:
            readingView === "original" ? state.referenceView : readingView,
        })),
      fontSize: 17,
      lineHeight: 1.9,
      speechVoiceId: null,
      speechRate: 0.9,
      setSpeechVoiceId: (speechVoiceId) => set({ speechVoiceId }),
      setSpeechRate: (speechRate) => set({ speechRate }),
      setFontSize: (fontSize) => set({ fontSize }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
    }),
    {
      name: "mftp-poetry",
      version: 1,
      // 新字段向后兼容版本 1；损坏的标签值不覆盖默认值或影响既有阅读偏好。
      merge: (persisted, current) => {
        const saved = persisted as Partial<PoetryState> | undefined;
        return {
          ...current,
          ...saved,
          readingView:
            resolvePoetryReadingView(saved?.readingView) ?? current.readingView,
          referenceView:
            resolvePoetryReferenceView(saved?.referenceView) ??
            current.referenceView,
        };
      },
      partialize: (state) => ({
        // 合集是运行时缓存；只持久化用户偏好。
        activeCollectionIds: state.activeCollectionIds,
        searchScope: state.searchScope,
        searchHistory: state.searchHistory,
        fontSize: state.fontSize,
        lineHeight: state.lineHeight,
        speechVoiceId: state.speechVoiceId,
        speechRate: state.speechRate,
        readingView: state.readingView,
        referenceView: state.referenceView,
      }),
    },
  ),
);
