import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  PoetryCollectionStatus,
  PoetrySearchScope,
} from "~/types";

interface PoetryState {
  /** Installed-collection cache mirrored from `poetry_collections()`. */
  collections: PoetryCollectionStatus[];
  setCollections: (collections: PoetryCollectionStatus[]) => void;

  /** Collection ids the list/detail views are filtered to; empty = all. */
  activeCollectionIds: string[];
  toggleCollection: (id: string) => void;
  clearCollectionFilter: () => void;

  /** Search scope + locally persisted history (latest first). */
  searchScope: PoetrySearchScope;
  setSearchScope: (scope: PoetrySearchScope) => void;
  searchHistory: string[];
  pushSearchHistory: (query: string) => void;
  clearSearchHistory: () => void;

  /** Reading preferences for the detail pane. */
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
        // Collections are runtime cache; persist only user preferences.
        activeCollectionIds: state.activeCollectionIds,
        searchScope: state.searchScope,
        searchHistory: state.searchHistory,
        fontSize: state.fontSize,
        lineHeight: state.lineHeight,
      }),
    },
  ),
);
