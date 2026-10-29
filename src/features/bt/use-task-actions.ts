import { useLingui } from "@lingui/react/macro";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { describeError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import { isMobilePlatform } from "~/lib/platform";
import { useTransfersStore } from "~/store/transfers";
import type { BtTaskInfo } from "~/types";

import { systemDownloadDir } from "./file-actions";
import { forgetBtTask } from "./task-sync";
import { refreshBtTasks } from "./tasks-store";

export function useBtTaskActions() {
  const { t } = useLingui();
  const pending = useRef(new Set<string>());
  const [busyTasks, setBusyTasks] = useState<ReadonlySet<string>>(new Set());

  async function run(
    task: BtTaskInfo,
    action: () => Promise<void | false>,
    title?: string,
  ) {
    const hash = task.infoHash;
    if (pending.current.has(hash)) return;
    pending.current.add(hash);
    setBusyTasks(new Set(pending.current));
    try {
      if ((await action()) !== false) await refreshBtTasks();
    } catch (error) {
      const message = describeError(error, t);
      if (title) toast.error(title, { description: message });
      else toast.error(message);
    } finally {
      pending.current.delete(hash);
      setBusyTasks(new Set(pending.current));
    }
  }

  function finish(task: BtTaskInfo) {
    forgetBtTask(task.infoHash);
    useTransfersStore.getState().finish(`bt:${task.infoHash}`, "cancelled");
  }

  const control = (task: BtTaskInfo, action: "Pause" | "Resume" | "Cancel") =>
    run(task, async () => {
      await ipc.btControl(task.infoHash, action, false);
      if (action === "Cancel") finish(task);
      else
        useTransfersStore
          .getState()
          .setPaused(`bt:${task.infoHash}`, action === "Pause");
    });

  const remove = (task: BtTaskInfo) =>
    run(task, async () => {
      await ipc.btControl(task.infoHash, "Remove", true);
      finish(task);
      toast.success(t`已删除`);
    });

  const exportTask = (task: BtTaskInfo) =>
    run(
      task,
      async () => {
        const mobile = isMobilePlatform();
        const destination = mobile
          ? ""
          : await openDialog({
              multiple: false,
              directory: true,
              defaultPath: (await systemDownloadDir()) || undefined,
            });
        if (typeof destination !== "string") return false;
        await ipc.btExport(task.infoHash, destination);
        toast.success(mobile ? t`已复制到系统下载目录` : t`已复制到用户目录`);
      },
      t`转存失败`,
    );

  return { busyTasks, control, remove, exportTask };
}
