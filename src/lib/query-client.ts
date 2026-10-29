import {
  QueryClient,
  type QueryKey,
  queryOptions,
} from "@tanstack/react-query";

import { type IpcError, toIpcError } from "~/lib/errors";

import { refreshQueries } from "./query-invalidation";

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        networkMode: "always",
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false, networkMode: "always", gcTime: 0 },
    },
  });
}

export const queryClient = createAppQueryClient();

const epochs = new WeakMap<QueryClient, Map<string, number>>();

/** 写操作只能更新它开始时的数据分区；重置后迟到结果不得重建旧缓存。 */
export function queryScopeGuard(client: QueryClient, scope: string) {
  let versions = epochs.get(client);
  if (!versions) {
    versions = new Map();
    epochs.set(client, versions);
  }
  const all = versions.get("*");
  const version = versions.get(scope);
  return () => versions.get("*") === all && versions.get(scope) === version;
}

/** 仅包装可缓存读取；原生句柄、凭据和有副作用的命令不经过此入口。 */
export function ipcQuery<T>(queryKey: QueryKey, read: () => Promise<T>) {
  return queryOptions<T, IpcError>({
    queryKey,
    queryFn: async () => {
      try {
        return await read();
      } catch (error) {
        throw toIpcError(error);
      }
    },
  });
}

export function invalidateData(scopes: readonly string[]) {
  // 只传模块身份，避免公共层导入所有业务与平台独占实现。
  return refreshQueries(queryClient, {
    predicate: (query) => scopes.includes(String(query.queryKey[0])),
  });
}

export function clearQueryData(
  scopes?: readonly string[],
  client = queryClient,
) {
  queryScopeGuard(client, "*");
  const versions = epochs.get(client)!;
  for (const scope of scopes ?? ["*"])
    versions.set(scope, (versions.get(scope) ?? 0) + 1);
  if (!scopes) {
    client.clear();
    return;
  }
  const filters = {
    predicate: (query) => scopes.includes(String(query.queryKey[0])),
  } satisfies import("@tanstack/react-query").QueryFilters;
  void client
    .resetQueries(filters)
    .then(() => refreshQueries(client, { ...filters, type: "inactive" }));
}
