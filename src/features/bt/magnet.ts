import type { BtTaskInfo } from "~/types";

/** 分享磁力链接时补上的公共 tracker；BT 引擎自身不带这些。 */
const SHARE_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
];

/** 由任务信息重建可重新添加的磁力链接。 */
export function magnetOf(task: BtTaskInfo): string {
  const trackers = SHARE_TRACKERS.map(
    (tracker) => `&tr=${encodeURIComponent(tracker)}`,
  ).join("");
  return `magnet:?xt=urn:btih:${task.infoHash}&dn=${encodeURIComponent(task.label)}${trackers}`;
}
