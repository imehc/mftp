import { useTransfersStore } from "~/store/transfers";
import type { BtTaskEvent } from "~/types";

import { forgetBtTask, transferIdOf } from "./task-sync";

/** 事件类型与错误载荷由 Rust 导出，错误在面板渲染时再本地化。 */
export function applyBtTaskEvent(event: BtTaskEvent): void {
  const { finish } = useTransfersStore.getState();
  const id = transferIdOf(event.infoHash);
  switch (event.kind) {
    case "package-completed":
      finish(id, "success");
      forgetBtTask(event.infoHash);
      break;
    case "package-failed":
      finish(id, "error", event.error);
      forgetBtTask(event.infoHash);
      break;
    case "cancelled":
      finish(id, "cancelled");
      forgetBtTask(event.infoHash);
      break;
    case "removed":
      forgetBtTask(event.infoHash);
      break;
    case "export-completed":
      // 转存不改变任务状态，也不该让任务重新走一次注册。
      break;
  }
}
