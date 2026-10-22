import { create } from "zustand";

declare module "@tanstack/react-router" {
  interface HistoryState {
    activityLogDetail?: boolean;
  }
}

export type ActivityTab = "tasks" | "logs";

export type LogFilter = "all" | "failed";

export type TransferFilter = "running" | "error" | "finished";

interface ActivityViewState {
  tab: ActivityTab;
  filter: LogFilter;
  scrollTop: number;
  following: boolean;
  focusedOperation: string | null;
  focusOperation: (operation: string) => void;
  transferFilter: TransferFilter;
  setTransferFilter: (filter: TransferFilter) => void;
  setTab: (tab: ActivityTab) => void;
  setFilter: (filter: LogFilter) => void;
  saveScroll: (scrollTop: number, following: boolean) => void;
}

export const useActivityViewStore = create<ActivityViewState>((set) => ({
  tab: "tasks",
  filter: "all",
  scrollTop: 0,
  following: true,
  focusedOperation: null,
  focusOperation: (focusedOperation) => set({ focusedOperation }),
  transferFilter: "running",
  setTransferFilter: (transferFilter) => set({ transferFilter }),
  setTab: (tab) => set({ tab }),
  setFilter: (filter) => set({ filter, scrollTop: 0, following: true }),
  saveScroll: (scrollTop, following) => set({ scrollTop, following }),
}));
