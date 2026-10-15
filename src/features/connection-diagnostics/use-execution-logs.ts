import { useEffect, useState } from "react";

import type { AppError, DiagnosticOperation } from "~/bindings";
import { toIpcError } from "~/lib/errors";

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
    clear: () => setOperations([]),
    recordFailure: (cause: unknown) => setError(toIpcError(cause).payload),
  };
}

export type ExecutionLogs = ReturnType<typeof useExecutionLogs>;
