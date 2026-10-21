import { useEffect, useState } from "react";

import type { AppError, DiagnosticOperation } from "~/bindings";
import { toIpcError } from "~/lib/errors";
import { diagnosticsClear } from "~/lib/ipc";

import { openExecutionLogSession } from "./execution-log-session";

/** 订阅应用级活动面板；记录只存在于后端内存，这里仅做投影。 */
export function useExecutionLogs() {
  const [operations, setOperations] = useState<DiagnosticOperation[]>([]);
  const [discarded, setDiscarded] = useState(0);
  const [error, setError] = useState<AppError | null>(null);
  useEffect(() => {
    const session = openExecutionLogSession((snapshot) => {
      if (snapshot.operations !== null) setOperations(snapshot.operations);
      setDiscarded(snapshot.discarded);
    }, setError);
    return session.close;
  }, []);

  return {
    operations,
    discarded,
    error,
    clear: () => {
      setOperations([]);
      setDiscarded(0);
      // 丢弃本批记录，不取消仍在执行的外部操作。
      void diagnosticsClear().catch(() => {});
    },
    recordFailure: (cause: unknown) => setError(toIpcError(cause).payload),
  };
}

export type ExecutionLogs = ReturnType<typeof useExecutionLogs>;
