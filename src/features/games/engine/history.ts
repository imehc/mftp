/**
 * 各游戏共享的持久化对局历史。每个游戏结束时记录一段自描述
 * 负载，并自行渲染其历史列表；本 store 只负责存储、排序与上限。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

const MAX_RECORDS = 50;

export interface GameHistoryRecord<P = unknown> {
  id: string;
  gameId: string;
  /** 结束时的墙上时钟时间（Date.now）——仅用于展示，不是游戏状态。 */
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
