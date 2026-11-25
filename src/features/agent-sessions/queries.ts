import { queryOptions } from "@tanstack/react-query";

import { agentSessionsCancel, agentSessionsSnapshot } from "~/lib/ipc";

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
