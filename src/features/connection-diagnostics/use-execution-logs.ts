import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import type { AppError, DiagnosticOperation } from "~/bindings";
import {
  clearLogQueries,
  logPageQuery,
  refreshLogQueries,
} from "~/features/logs/queries";
import { toIpcError } from "~/lib/errors";
import { createSubscription } from "~/lib/event-subscription";
import { ACTIVITY_PANEL } from "~/lib/events";

export const LOG_FALLBACK_MS = 5000;

/** 根运行期只装一次事件桥接；活动与历史消费者读取同一摘要查询。 */
export function useExecutionLogs() {
  const client = useQueryClient();
  const query = useQuery(logPageQuery());
  const [failure, setFailure] = useState<AppError | null>(null);
  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (closed) return;
        void refreshLogQueries(client);
        schedule();
      }, LOG_FALLBACK_MS);
    };

    const subscription = createSubscription(
      () =>
        listen(ACTIVITY_PANEL, () => {
          if (closed) return;
          void refreshLogQueries(client);
          schedule();
        }),
      { onError: (cause) => setFailure(toIpcError(cause).payload) },
    );
    schedule();
    return () => {
      closed = true;
      clearTimeout(timer);
      subscription.dispose();
    };
  }, [client]);
  return {
    operations:
      query.data?.entries
        .map((entry) => entry.operation)
        .filter((entry): entry is DiagnosticOperation => entry !== null) ?? [],
    discarded: query.data?.health.discarded ?? 0,
    error: failure ?? query.error?.payload ?? query.data?.health.error ?? null,
    loading: query.isLoading,
    refresh: () => {
      setFailure(null);
      void refreshLogQueries(client);
    },
    clear: () => clearLogQueries(client),
    recordFailure: (cause: unknown) => setFailure(toIpcError(cause).payload),
  };
}

export type ExecutionLogs = ReturnType<typeof useExecutionLogs>;
