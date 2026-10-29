import { translationSnapshot } from "~/lib/ipc";
import { ipcQuery } from "~/lib/query-client";

export const translationSnapshotQuery = () => ({
  ...ipcQuery(["translation", "snapshot"], translationSnapshot),
  staleTime: 0,
});
