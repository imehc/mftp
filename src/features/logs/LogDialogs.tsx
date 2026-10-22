import { Trans, useLingui } from "@lingui/react/macro";
import { Ellipsis } from "lucide-react";
import { useState } from "react";

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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

import { logAction, logObject } from "./log-labels";
import { logDetail } from "./log-utils";
import type { ActivityLogsController } from "./use-activity-logs";

export default function LogDialogs({
  controller: c,
}: {
  controller: ActivityLogsController;
}) {
  const { t, i18n } = useLingui();
  const [metadata, setMetadata] = useState(false);
  const row = c.selected;
  return (
    <>
      <Dialog
        open={!!row}
        onOpenChange={(open) => {
          if (!open && !c.busy) {
            c.setSelected(null);
            setMetadata(false);
          }
        }}
      >
        <DialogLayoutContent
          className="ui-density-adaptive"
          showCloseButton={false}
        >
          <DialogLayoutHeader showCloseButton>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <DialogTitle>
                <Trans>日志详情</Trans>
              </DialogTitle>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    density="adaptive"
                    aria-label={t({
                      comment: "历史日志详情的按需元信息菜单",
                      message: "日志详情操作",
                    })}
                  >
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="ui-density-adaptive"
                >
                  <DropdownMenuGroup>
                    <DropdownMenuCheckboxItem
                      checked={metadata}
                      onCheckedChange={setMetadata}
                    >
                      <Trans comment="历史日志详情菜单，按需显示内部标识和原始对象">
                        元信息
                      </Trans>
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
                <dd className="wrap-break-word">
                  {c.sourceLabels[row.source] ?? row.source}
                </dd>
                <dt className="text-muted-foreground">
                  <Trans>操作</Trans>
                </dt>
                <dd className="wrap-break-word">{logAction(row, t)}</dd>
                <dt className="text-muted-foreground">
                  <Trans>对象</Trans>
                </dt>
                <dd className="break-all">{logObject(row, t)}</dd>
                <dt className="text-muted-foreground">
                  <Trans>结果</Trans>
                </dt>
                <dd>{c.resultLabels[row.result] ?? row.result}</dd>
                <dt className="text-muted-foreground">
                  <Trans>详情</Trans>
                </dt>
                <dd className="wrap-break-word whitespace-pre-wrap">
                  {logDetail(row, t)}
                </dd>
                {metadata ? (
                  <>
                    <dt className="text-muted-foreground">
                      <Trans comment="日志详情：后端保存的原始操作代码，用于排查问题">
                        操作标识
                      </Trans>
                    </dt>
                    <dd className="font-mono text-xs break-all">
                      {row.requestType}
                    </dd>
                    {row.operationId ? (
                      <>
                        <dt className="text-muted-foreground">
                          <Trans comment="用于关联持久操作摘要与内存执行详情的同一次操作身份">
                            执行记录 ID
                          </Trans>
                        </dt>
                        <dd className="font-mono text-xs break-all">
                          {row.operationId}
                        </dd>
                      </>
                    ) : null}
                    {row.ip ? (
                      <>
                        <dt className="text-muted-foreground">
                          <Trans comment="日志详情：后端保存的完整对象 ID、地址或路径">
                            对象原值
                          </Trans>
                        </dt>
                        <dd className="font-mono text-xs break-all">
                          {row.ip}
                        </dd>
                      </>
                    ) : null}
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
                <Trans comment="清空范围仅限 SQLite 持久操作摘要，不删除运行期协议详情或终止任务">
                  所有历史日志都会被删除，且无法恢复。运行期日志和正在执行的任务不受影响。
                </Trans>
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
