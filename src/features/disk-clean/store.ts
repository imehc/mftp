import { create } from "zustand";
import type {
  CleanRule,
  ScanPhase,
  ScanProgress,
  ScannedItem,
  VolumeStat,
} from "~/types";

/** Live counters from `disk-clean://progress`. */
export interface ScanCounters {
  scannedFiles: number;
  scannedDirs: number;
  totalBytes: number;
  skipped: number;
}

const emptyCounters: ScanCounters = {
  scannedFiles: 0,
  scannedDirs: 0,
  totalBytes: 0,
  skipped: 0,
};

interface DiskCleanState {
  rules: CleanRule[];
  volume: VolumeStat | null;
  /** Rule ids the user has ticked. */
  selectedRules: Set<string>;
  /** Result paths the user has ticked for removal. */
  selectedPaths: Set<string>;
  jobId: string | null;
  phase: ScanPhase | null;
  counters: ScanCounters;
  items: ScannedItem[];
  error: string | null;

  setRules: (rules: CleanRule[]) => void;
  setVolume: (volume: VolumeStat) => void;
  toggleRule: (id: string) => void;
  togglePath: (path: string) => void;
  setSelectedPaths: (paths: string[]) => void;
  startJob: (jobId: string) => void;
  applyProgress: (progress: ScanProgress) => void;
  finishJob: (items: ScannedItem[], counters: ScanCounters) => void;
  failJob: (phase: ScanPhase, error: string | null) => void;
  removePaths: (paths: string[]) => void;
  reset: () => void;
}

export const useDiskCleanStore = create<DiskCleanState>((set) => ({
  rules: [],
  volume: null,
  selectedRules: new Set(),
  selectedPaths: new Set(),
  jobId: null,
  phase: null,
  counters: emptyCounters,
  items: [],
  error: null,

  setRules: (rules) =>
    set({
      rules,
      // Safe-tier rules are ticked by default; caution needs a deliberate
      // choice and manual can never be deleted at all.
      selectedRules: new Set(
        rules.filter((rule) => rule.tier === "safe").map((rule) => rule.id),
      ),
    }),
  setVolume: (volume) => set({ volume }),

  toggleRule: (id) =>
    set((state) => {
      const next = new Set(state.selectedRules);
      if (!next.delete(id)) next.add(id);
      return { selectedRules: next };
    }),

  togglePath: (path) =>
    set((state) => {
      const next = new Set(state.selectedPaths);
      if (!next.delete(path)) next.add(path);
      return { selectedPaths: next };
    }),

  setSelectedPaths: (paths) => set({ selectedPaths: new Set(paths) }),

  startJob: (jobId) =>
    set({
      jobId,
      phase: "expanding",
      counters: emptyCounters,
      items: [],
      selectedPaths: new Set(),
      error: null,
    }),

  // Progress events carry the job id; a late event from a superseded job must
  // not overwrite the current one's counters.
  applyProgress: (progress) =>
    set((state) =>
      state.jobId && progress.jobId !== state.jobId
        ? {}
        : {
            phase: progress.phase,
            counters: {
              scannedFiles: progress.scannedFiles,
              scannedDirs: progress.scannedDirs,
              totalBytes: progress.totalBytes,
              skipped: progress.skipped,
            },
          },
    ),

  finishJob: (items, counters) =>
    set({
      phase: "completed",
      items,
      counters,
      // Preselect nothing: deletion must be a deliberate tick, never a default.
      selectedPaths: new Set(),
    }),

  failJob: (phase, error) => set({ phase, error }),

  removePaths: (paths) =>
    set((state) => {
      const gone = new Set(paths);
      const selected = new Set(state.selectedPaths);
      for (const path of paths) selected.delete(path);
      return {
        items: state.items.filter((item) => !gone.has(item.path)),
        selectedPaths: selected,
      };
    }),

  reset: () =>
    set({
      jobId: null,
      phase: null,
      counters: emptyCounters,
      items: [],
      selectedPaths: new Set(),
      error: null,
    }),
}));
