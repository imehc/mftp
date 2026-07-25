/**
 * Persisted match history shared by all games. Each game records a
 * self-describing payload on finish and renders its own history list;
 * the store only handles storage, ordering, and capping.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

const MAX_RECORDS = 50;

export interface GameHistoryRecord<P = unknown> {
  id: string;
  gameId: string;
  /** Wall-clock finish time (Date.now) — display only, not game state. */
  finishedAt: number;
  payload: P;
}

interface GamesHistoryState {
  records: GameHistoryRecord[];
  addRecord: (record: GameHistoryRecord) => void;
  clearGame: (gameId: string) => void;
}

export const useGamesHistoryStore = create<GamesHistoryState>()(
  persist(
    (set) => ({
      records: [],
      addRecord: (record) =>
        set((state) => ({
          records: [record, ...state.records].slice(0, MAX_RECORDS),
        })),
      clearGame: (gameId) =>
        set((state) => ({
          records: state.records.filter((r) => r.gameId !== gameId),
        })),
    }),
    { name: "mftp-games-history", version: 1 },
  ),
);

export function useGameHistory<P>(gameId: string): GameHistoryRecord<P>[] {
  return useGamesHistoryStore((s) => s.records).filter(
    (r): r is GameHistoryRecord<P> => r.gameId === gameId,
  );
}
