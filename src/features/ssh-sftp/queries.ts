import { sftpInfo, sftpList } from "~/lib/ipc";
import { ipcQuery, queryClient } from "~/lib/query-client";
import { refreshQueries } from "~/lib/query-invalidation";

import { normalizeRemotePath } from "./components/sftp/SftpPanel.utils";

export const sshQueryKey = (sessionId: string) => ["ssh", sessionId] as const;

export function directoryQuery(sessionId: string, path: string) {
  const normalized = normalizeRemotePath(path);
  return {
    ...ipcQuery([...sshQueryKey(sessionId), "directory", normalized], () =>
      sftpList(sessionId, normalized),
    ),
    staleTime: 0,
  };
}

export const fileInfoQuery = (sessionId: string, path: string) =>
  ipcQuery([...sshQueryKey(sessionId), "stat", normalizeRemotePath(path)], () =>
    sftpInfo(sessionId, path),
  );

export function forgetSessionQueries(sessionId: string) {
  queryClient.removeQueries({ queryKey: sshQueryKey(sessionId) });
}

/** 写入和部分失败都可能改变源、目标及子目录；使本会话的文件投影重新读取。 */
export async function runSftpWrite<T>(
  sessionId: string,
  action: () => Promise<T>,
) {
  try {
    return await action();
  } finally {
    const filters = {
      predicate: (query: import("@tanstack/react-query").Query) =>
        query.queryKey[0] === "ssh" &&
        query.queryKey[1] === sessionId &&
        ["directory", "stat"].includes(String(query.queryKey[2])),
    };
    await queryClient.cancelQueries(filters);
    void refreshQueries(queryClient, filters);
  }
}
