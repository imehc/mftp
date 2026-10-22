import { useEffect, useRef, useState } from "react";

import type { AppError, DiagnosticOperation } from "~/bindings";
import { toIpcError } from "~/lib/errors";
import { diagnosticsClear } from "~/lib/ipc";

import { openExecutionLogSession } from "./execution-log-session";

/** 订阅应用级活动面板；记录只存在于后端内存，这里仅做投影。 */
export function useExecutionLogs() {
  const [operations, setOperations] = useState<DiagnosticOperation[]>([]);
  const [discarded, setDiscarded] = useState(0);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionRef = useRef<ReturnType<typeof openExecutionLogSession> | null>(
    null,
  );
  useEffect(() => {
    const session = openExecutionLogSession(
      (snapshot) => {
        if (snapshot.operations !== null) setOperations(snapshot.operations);
        setDiscarded(snapshot.discarded);
        setLoading(false);
      },
      (cause) => {
        setError(cause);
        setLoading(false);
      },
    );
    sessionRef.current = session;
    return () => {
      sessionRef.current = null;
      session.close();
    };
  }, []);

  return {
    operations,
    discarded,
    error,
    loading,
    clear: async () => {
      await diagnosticsClear();
      sessionRef.current?.refresh();
      // 丢弃本批记录，不取消仍在执行的外部操作。
    },
    recordFailure: (cause: unknown) => setError(toIpcError(cause).payload),
  };
}

export type ExecutionLogs = ReturnType<typeof useExecutionLogs>;
