import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { LIBRARY_SYNC_PROGRESS } from "~/lib/events";
import type { PoetrySyncProgress } from "~/types";

export interface SyncProgressState {
  active: boolean;
  collectionId: string | null;
  /** downloading | importing | indexing | done | error */
  phase: string | null;
  bytesDone: number;
  bytesTotal: number | null;
  imported: number;
  /** Known total for the current importing phase, when reported. */
  total: number | null;
  /** Set only on the terminal `error` phase. */
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
 * Subscribes to `library://sync-progress` for the manage page and sync
 * badges. Events arrive per-collection; the latest wins.
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
        // Terminal events end the job; streaming events go quiet after 30s.
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
