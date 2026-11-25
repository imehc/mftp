import { queryOptions } from "@tanstack/react-query";

import {
  agentSessionsCancel,
  agentSessionsSnapshot,
  agentSessionsStorage,
} from "~/lib/ipc";

export const agentSourcesQuery = () =>
  queryOptions({
    queryKey: ["agent-sessions", "sources"],
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const requestId = crypto.randomUUID();

      const cancel = () => {
        void agentSessionsCancel(requestId).catch(() => {});
      };

      signal.addEventListener("abort", cancel, { once: true });
      try {
        return await agentSessionsSnapshot(false, requestId);
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
  });

export const agentStorageQuery = (generation: string, enabled = true) =>
  queryOptions({
    queryKey: ["agent-sessions", "storage", generation],
    enabled: enabled && !!generation,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const requestId = crypto.randomUUID();

      const cancel = () => {
        void agentSessionsCancel(requestId).catch(() => {});
      };

      signal.addEventListener("abort", cancel, { once: true });
      try {
        return await agentSessionsStorage(generation, requestId);
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
  });
