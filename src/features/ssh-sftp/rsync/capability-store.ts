import { useQuery } from "@tanstack/react-query";

import { toIpcError } from "~/lib/errors";
import { rsyncCapabilities } from "~/lib/ipc";
import { ipcQuery, queryClient } from "~/lib/query-client";
import type { AppError, RsyncCapabilities } from "~/types";

export interface RsyncCapabilityEntry {
  capabilities: RsyncCapabilities | null;
  loading: boolean;
  error: AppError | null;
}

export const rsyncCapabilityKey = (sessionId: string) =>
  ["ssh", sessionId, "rsync"] as const;
const options = (sessionId: string, refresh = false) => ({
  ...ipcQuery(rsyncCapabilityKey(sessionId), () =>
    rsyncCapabilities(sessionId, refresh),
  ),
  staleTime: Infinity,
});

/** 显式刷新等待旧探测退出；会话关闭后不再启动排队探测。 */
export async function loadRsyncCapabilities(
  sessionId: string,
  refresh = false,
): Promise<RsyncCapabilities | null> {
  const key = rsyncCapabilityKey(sessionId);
  const current = queryClient
    .getQueryCache()
    .find({ queryKey: key, exact: true });
  try {
    if (refresh && current?.promise) {
      await current.promise.catch(() => undefined);
      if (
        queryClient.getQueryCache().find({ queryKey: key, exact: true }) !==
        current
      )
        return null;
    }
    return await queryClient.query({
      ...options(sessionId, refresh),
      ...(refresh ? { staleTime: 0 } : {}),
    });
  } catch {
    return null;
  }
}

export function forgetRsyncCapabilities(sessionId: string) {
  queryClient.removeQueries({ queryKey: rsyncCapabilityKey(sessionId) });
}

export function useRsyncCapability(sessionId: string): RsyncCapabilityEntry {
  const query = useQuery({ ...options(sessionId), enabled: false });
  return {
    capabilities: query.data ?? null,
    loading: query.isFetching,
    error: query.error ? toIpcError(query.error).payload : null,
  };
}
