import { useEffect, useRef } from "react";

import { useGamesHistoryStore } from "../engine/history";
import {
  BILLIARDS_GAME_ID,
  type BilliardsHistoryPayload,
  type BilliardsMode,
  type BilliardsState,
} from "./types";

/**
 * 每场已结束的对局只持久化一条历史记录。
 * `recordedRef` 负责去重；传入的各项在本 keyed 对局实例的整个生命周期内稳定。
 */
export function useBilliardsMatchRecord(
  mode: BilliardsMode,
  recordId: string,
  winnerSeat: number | null,
  state: BilliardsState,
): void {
  const addRecord = useGamesHistoryStore((store) => store.addRecord);
  const recordedRef = useRef(false);

  useEffect(() => {
    if (!state.finished || recordedRef.current) return;
    recordedRef.current = true;
    addRecord({
      id: recordId,
      gameId: BILLIARDS_GAME_ID,
      finishedAt: Date.now(),
      payload: {
        version: 2,
        discipline: mode.discipline ?? "eight-ball",
        mode: mode.kind,
        difficulty: mode.kind === "ai" ? mode.difficulty : undefined,
        winnerSeat,
        shots: state.shotCount,
        fouls: state.foulCounts,
        reds: mode.discipline === "snooker" ? mode.reds : undefined,
        scores: state.variant === "snooker" ? state.scores : undefined,
        highestBreaks:
          state.variant === "snooker" ? state.highestBreaks : undefined,
      } satisfies BilliardsHistoryPayload,
    });
  }, [addRecord, mode, recordId, winnerSeat, state]);
}
