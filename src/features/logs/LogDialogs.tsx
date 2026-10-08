import { Trans, useLingui } from "@lingui/react/macro";

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
import { Button } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";

import { logAction, logObject } from "./log-labels";
import { logDetail } from "./log-utils";
import type { ActivityLogsController } from "./use-activity-logs";

export default function LogDialogs({
  controller: c,
}: {
  controller: ActivityLogsController;
}) {
  const { i18n } = useLingui();
  const row = c.selected;
  return (
    <>
      <Dialog
        open={!!row}
        onOpenChange={(open) => {
          if (!open && !c.busy) c.setSelected(null);
        }}
      >
        <DialogLayoutContent
          className="ui-density-adaptive"
          showCloseButton={false}
        >
          <DialogLayoutHeader showCloseButton>
            <DialogTitle>
              <Trans>日志详情</Trans>
            </DialogTitle>
            <DialogDescription className="sr-only">
              {row ? new Date(row.createdAt).toLocaleString(i18n.locale) : null}
            </DialogDescription>
          </DialogLayoutHeader>
          <DialogLayoutBody>
            {row ? (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
                <dt className="text-muted-foreground">
                  <Trans>时间</Trans>
                </dt>
                <dd className="tabular-nums">
                  {new Date(row.createdAt).toLocaleString(i18n.locale)}
                </dd>
                <dt className="text-muted-foreground">
                  <Trans>来源</Trans>
                </dt>
                <dd className="break-words">
                  {c.sourceLabels[row.source] ?? row.source}
                </dd>
                <dt className="text-muted-foreground">
                  <Trans>操作</Trans>
                </dt>
                <dd className="break-words">{logAction(row)}</dd>
                <dt className="text-muted-foreground">
                  <Trans>对象</Trans>
                </dt>
                <dd className="break-all">{logObject(row)}</dd>
                <dt className="text-muted-foreground">
                  <Trans>结果</Trans>
                </dt>
                <dd>{c.resultLabels[row.result] ?? row.result}</dd>
                <dt className="text-muted-foreground">
                  <Trans>详情</Trans>
                </dt>
                <dd className="break-words whitespace-pre-wrap">
                  {logDetail(row) || "—"}
                </dd>
                <dt className="text-muted-foreground">
                  <Trans comment="日志详情：后端保存的原始操作代码，用于排查问题">
                    操作标识
                  </Trans>
                </dt>
                <dd className="font-mono text-xs break-all">
                  {row.requestType}
                </dd>
                {row.ip ? (
                  <>
                    <dt className="text-muted-foreground">
                      <Trans comment="日志详情：后端保存的完整对象 ID、地址或路径">
                        对象原值
                      </Trans>
                    </dt>
                    <dd className="font-mono text-xs break-all">{row.ip}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
          </DialogLayoutBody>
          <DialogLayoutFooter>
            <Button
              variant="destructive"
              disabled={c.busy}
              onClick={() => c.setDeleting(row)}
            >
              <Trans>删除日志</Trans>
            </Button>
          </DialogLayoutFooter>
        </DialogLayoutContent>
      </Dialog>
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
                <Trans>清空日志</Trans>
              ) : (
                <Trans>删除这条日志？</Trans>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {c.deleting === "all" ? (
                <Trans>所有日志记录都会被删除，且无法恢复。</Trans>
              ) : (
                <Trans>删除后无法恢复。</Trans>
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
    </>
  );
}
