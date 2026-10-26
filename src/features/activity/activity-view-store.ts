import { create } from "zustand";

declare module "@tanstack/react-router" {
  interface HistoryState {
    activityLogDetail?: boolean;
  }
}

export type ActivityTab = "tasks" | "logs";

export type LogFilter =
  "all" | "failed" | "success" | "canceled" | "running" | "unverified";

export type TransferFilter = "running" | "error" | "finished";

interface ActivityViewState {
  tab: ActivityTab;
  filter: LogFilter;
  query: string;
  source: string;
  range: string;
  setLogQuery: (query: string) => void;
  setLogSource: (source: string) => void;
  setLogRange: (range: string) => void;
  scrollTop: number;
  scrollAnchor: { id: string; offset: number } | null;
  following: boolean;
  focusedOperation: string | null;
  focusOperation: (operation: string) => void;
  transferFilter: TransferFilter;
  setTransferFilter: (filter: TransferFilter) => void;
  setTab: (tab: ActivityTab) => void;
  setFilter: (filter: LogFilter) => void;
  saveScroll: (
    scrollTop: number,
    following: boolean,
    anchor?: { id: string; offset: number } | null,
  ) => void;
}

export const useActivityViewStore = create<ActivityViewState>((set) => ({
  tab: "tasks",
  filter: "all",
  query: "",
  source: "all",
  range: "all",
  setLogQuery: (query) => set({ query, scrollTop: 0, following: true }),
  setLogSource: (source) => set({ source, scrollTop: 0, following: true }),
  setLogRange: (range) => set({ range, scrollTop: 0, following: true }),
  scrollTop: 0,
  scrollAnchor: null,
  following: true,
  focusedOperation: null,
  focusOperation: (focusedOperation) => set({ focusedOperation }),
  transferFilter: "running",
  setTransferFilter: (transferFilter) => set({ transferFilter }),
  setTab: (tab) => set({ tab }),
  setFilter: (filter) => set({ filter, scrollTop: 0, following: true }),
  saveScroll: (scrollTop, following, anchor) =>
    set({
      scrollTop,
      following,
      ...(anchor !== undefined ? { scrollAnchor: anchor } : {}),
    }),
}));
