import type { QueryClient } from "@tanstack/react-query";

import { diagnosticsClear, logsDetail, logsPage } from "~/lib/ipc";
import { ipcQuery } from "~/lib/query-client";
import { refreshQueries } from "~/lib/query-invalidation";

export const logPageKey = ["logs", "page"] as const;
export const logPageQuery = () =>
  ipcQuery(logPageKey, () => logsPage(undefined, 500));
export const logDetailQuery = (id: string) => ({
  ...ipcQuery(["logs", "detail", id], () => logsDetail(id)),
  gcTime: 0,
});
export const refreshLogQueries = (client: QueryClient) =>
  refreshQueries(client, { queryKey: ["logs"] });

export async function clearLogQueries(client: QueryClient) {
  await diagnosticsClear();
  // 取消旧结果接纳，再按清理后的文件重建摘要和正在查看的详情。
  void client.resetQueries({ queryKey: ["logs"] });
}
