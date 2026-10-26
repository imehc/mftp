import { Trans } from "@lingui/react/macro";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";

import type { ActivityLogsController } from "./use-activity-logs";

export default function LogDialogs({
  controller: c,
}: {
  controller: ActivityLogsController;
}) {
  return (
    <AlertDialog
      open={!!c.deleting}
      onOpenChange={(open) => {
        if (!open && !c.busy) c.setDeleting(null);
      }}
    >
      <AlertDialogContent className="ui-density-adaptive">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {c.deleting === "all" ? (
              <Trans>删除全部历史摘要？</Trans>
            ) : (
              <Trans>删除这条历史摘要？</Trans>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {c.deleting === "all" ? (
              <Trans>
                所有历史摘要都会被删除，且无法恢复。当前执行详情和正在运行的任务不受影响。
              </Trans>
            ) : (
              <Trans>
                这条历史摘要将被永久删除。当前执行详情和正在运行的任务不受影响。
              </Trans>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={c.busy}>
            <Trans>取消</Trans>
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={c.busy}
            onClick={(event) => {
              event.preventDefault();
              void c.remove();
            }}
          >
            <Trans>确认删除</Trans>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
