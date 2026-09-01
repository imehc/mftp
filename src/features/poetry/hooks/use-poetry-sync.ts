import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { LIBRARY_SYNC_PROGRESS } from "~/lib/events";
import type { PoetrySyncProgress } from "~/types";

export interface SyncProgressState {
  active: boolean;
  collectionId: string | null;
  /** downloading（下载中）/ importing（导入中）/ indexing（建索引中）/ done（完成）/ error（出错） */
  phase: string | null;
  bytesDone: number;
  bytesTotal: number | null;
  imported: number;
  /** 当前导入阶段已知的合计总数，上报时存在。 */
  total: number | null;
  /** 仅在终态 `error` 阶段设置。 */
  errorMessage: string | null;
  updatedAt: number;
}

const IDLE: SyncProgressState = {
  active: false,
  collectionId: null,
  phase: null,
  bytesDone: 0,
  bytesTotal: null,
  imported: 0,
  total: null,
  errorMessage: null,
  updatedAt: 0,
};

/**
 * 为数据管理页和同步徽标订阅 `library://sync-progress`。事件按合集
 * 到达；以最新一次为准。
 */
export function usePoetrySyncProgress(): SyncProgressState {
  const [state, setState] = useState<SyncProgressState>(IDLE);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const promise = listen<PoetrySyncProgress>(
      LIBRARY_SYNC_PROGRESS,
      (event) => {
        const payload = event.payload;
        const terminal = payload.phase === "done" || payload.phase === "error";
        setState({
          active: !terminal,
          collectionId: payload.collectionId,
          phase: payload.phase,
          bytesDone: payload.bytesDone,
          bytesTotal: payload.bytesTotal,
          imported: payload.imported,
          total: payload.total,
          errorMessage: payload.error ?? null,
          updatedAt: Date.now(),
        });
        clearTimeout(timeoutRef.current);
        // 终态事件结束任务；流式事件在 30 秒后无更新则归于静默。
        if (!terminal) {
          timeoutRef.current = setTimeout(() => setState(IDLE), 30_000);
        }
      },
    );
    return () => {
      clearTimeout(timeoutRef.current);
      void promise.then((unlisten) => unlisten());
    };
  }, []);

  return state;
}
