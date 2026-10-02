import type { BtTaskInfo } from "~/types";
import { useTransfersStore } from "~/store/transfers";
import { magnetOf } from "./magnet";

/**
 * BT 任务与全局传输面板的投影。
 *
 * 这段逻辑原先挂在 BT 页面上：只有打开 BT 页才会把任务注册进传输面板，
 * 失败/完成也只在那时被消费。任务的实际生命周期由后端引擎持有，与页面
 * 无关，所以改由模块运行期在任意页面驱动。
 */

/** 记录已经注册过的任务签名，避免轮询重复 start/restore。 */
const registered = new Map<string, string>();

export function transferIdOf(infoHash: string): string {
  return `bt:${infoHash}`;
}

/** 丢弃登记，使下一次同步重新注册（删除、取消后调用）。 */
export function forgetBtTask(infoHash: string): void {
  registered.delete(infoHash);
}

export function syncBtTask(task: BtTaskInfo, explicit = false): void {
  const id = transferIdOf(task.infoHash);
  const signature = task.packageMode;
  const current = useTransfersStore
    .getState()
    .transfers.find((item) => item.id === id);
  const changed = registered.get(task.infoHash) !== signature;
  const shouldStart = explicit
    ? changed || !current || current.status !== "running"
    : (task.state === "Downloading" || task.status === "Packaging") &&
      (changed || !current);
  if (shouldStart) {
    registered.set(task.infoHash, signature);
    const options = {
      cancellable: true,
      source: "bt" as const,
      retry: { kind: "bt-add" as const, magnet: magnetOf(task) },
    };
    const { start, restore } = useTransfersStore.getState();
    (explicit ? start : restore)(id, task.label, options);
  }
  if (task.status === "Packaging") {
    useTransfersStore.getState().updateProgressBatch([
      {
        id,
        phase: "bt:packaging",
        transferred: task.progress ?? 0,
        total: task.total ?? null,
        finished: false,
      },
    ]);
  } else if (task.status === "Error") {
    useTransfersStore.getState().finish(id, "error", task.error ?? undefined);
  }
}

/** 用一次任务快照驱动面板状态：终态结账，其余按需注册。 */
export function syncBtTasks(tasks: readonly BtTaskInfo[]): void {
  for (const task of tasks) {
    const id = transferIdOf(task.infoHash);
    if (task.status === "Completed" || task.status === "Cancelled") {
      const current = useTransfersStore
        .getState()
        .transfers.find((item) => item.id === id);
      if (current?.status === "running") {
        useTransfersStore
          .getState()
          .finish(id, task.status === "Completed" ? "success" : "cancelled");
      }
      registered.delete(task.infoHash);
      continue;
    }
    syncBtTask(task);
  }
}
