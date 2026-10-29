import * as ipc from "~/lib/ipc";
import { ipcQuery, queryClient } from "~/lib/query-client";
import { createQueryResource } from "~/lib/query-resource";

// 引擎的初始化和刷新准入仍由 BT 运行期决定，观察者本身不执行列表命令。
export const btTasksQuery = createQueryResource(
  ["bt", "tasks"],
  ipc.btList,
  queryClient,
  () => {},
);
export const peersQuery = (infoHash: string) => ({
  ...ipcQuery(["bt", infoHash, "peers"], () => ipc.btTaskPeers(infoHash)),
  staleTime: 0,
  gcTime: 30_000,
});
export const filesQuery = (infoHash: string, path: string | null) => ({
  ...ipcQuery(["bt", infoHash, "files", path ?? ""], () =>
    ipc.btBrowseFiles(infoHash, path),
  ),
  staleTime: 0,
  gcTime: 30_000,
});

export function forgetBtTask(infoHash: string) {
  btTasksQuery.cancel();
  queryClient.removeQueries({ queryKey: ["bt", infoHash] });
}
