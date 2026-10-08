import type { BtTaskInfo } from "~/types";

import { useBtTasksStore } from "./tasks-store";

const NO_PEER_HINT_DELAY = 15000;

/** 记录每个任务「持续无对等节点」的起点，用于区分「刚连接」与「卡住」。 */
const zeroPeersSince = new Map<string, number>();

/**
 * 由任务快照评估「长时间没有对等节点」提示。
 *
 * 这是快照的派生状态，归模块运行期（快照写入后调用），不放在页面里，
 * 也不需要在 React effect 里同步 setState。
 */
export function updatePeerWatch(tasks: readonly BtTaskInfo[]): void {
  const now = Date.now();
  const stalled = new Set<string>();
  for (const task of tasks) {
    if (task.state !== "Downloading" || task.peersLive > 0) {
      zeroPeersSince.delete(task.infoHash);
      continue;
    }
    const since = zeroPeersSince.get(task.infoHash) ?? now;
    zeroPeersSince.set(task.infoHash, since);
    if (now - since >= NO_PEER_HINT_DELAY) stalled.add(task.infoHash);
  }
  const previous = useBtTasksStore.getState().noPeers;
  const unchanged =
    previous.size === stalled.size &&
    [...stalled].every((hash) => previous.has(hash));
  if (unchanged) return;
  useBtTasksStore.getState().setNoPeers(stalled);
}
