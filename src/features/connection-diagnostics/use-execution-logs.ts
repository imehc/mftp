import { useEffect, useRef, useState } from "react";

import type {
  AppError,
  DiagnosticOperation,
  DiagnosticSnapshot,
} from "~/bindings";
import { toIpcError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";

import { openExecutionLogSession } from "./execution-log-session";

/** 统一读取文件日志投影；活动事件只触发重读，游标仍由后端负责判定。 */
export function useExecutionLogs() {
  const [operations, setOperations] = useState<DiagnosticOperation[]>([]);
  const [discarded, setDiscarded] = useState(0);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const reading = useRef(false);
  const mounted = useRef(false);
  const refreshRef = useRef<() => void>(() => undefined);

  function applySnapshot(snapshot: DiagnosticSnapshot) {
    if (snapshot.operations !== null) setOperations(snapshot.operations);
    setDiscarded(snapshot.discarded);
    setError(null);
    setLoading(false);
  }

  async function read() {
    if (reading.current || typeof ipc.logsPage !== "function") return;
    reading.current = true;
    try {
      const page = await ipc.logsPage(undefined, 500);
      if (!mounted.current) return;
      setOperations(
        page.entries
          .map((entry) => entry.operation)
          .filter((entry): entry is DiagnosticOperation => entry !== null),
      );
      setDiscarded(page.health.discarded);
      setError(page.health.error);
    } catch (cause) {
      if (mounted.current) setError(toIpcError(cause).payload);
    } finally {
      reading.current = false;
      if (mounted.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    const session = openExecutionLogSession(
      (snapshot) => {
        if (typeof ipc.logsPage === "function") void read();
        else applySnapshot(snapshot);
      },
      (cause) => {
        if (cause && mounted.current) setError(cause);
      },
    );
    refreshRef.current = () => {
      if (typeof ipc.logsPage === "function") void read();
      else session.refresh();
    };
    return () => {
      mounted.current = false;
      refreshRef.current = () => undefined;
      session.close();
    };
  }, []);

  return {
    operations,
    discarded,
    error,
    loading,
    refresh: () => refreshRef.current(),
    clear: async () => {
      await ipc.diagnosticsClear();
      refreshRef.current();
      // 清理文件与当前快照，不取消仍在执行的外部操作。
    },
    recordFailure: (cause: unknown) => setError(toIpcError(cause).payload),
  };
}

export type ExecutionLogs = ReturnType<typeof useExecutionLogs>;
