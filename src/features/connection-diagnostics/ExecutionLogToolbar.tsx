import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowUp, Ellipsis, FolderOpen, RefreshCw } from "lucide-react";
import { useState } from "react";

import type { AppError } from "~/bindings";
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useActivityViewStore } from "~/features/activity/activity-view-store";
import { describeError, toIpcError } from "~/lib/errors";
import { logsOpenDirectory } from "~/lib/ipc";

import type { ExecutionLogs } from "./use-execution-logs";

export default function ExecutionLogToolbar({ logs }: { logs: ExecutionLogs }) {
  const { t } = useLingui();
  const { following, saveScroll } = useActivityViewStore();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const onLatest = () =>
    saveScroll(useActivityViewStore.getState().scrollTop, true);

  async function openDirectory() {
    setError(null);
    try {
      await logsOpenDirectory();
    } catch (cause) {
      setError(toIpcError(cause).payload);
    }
  }

  async function clear() {
    if (clearing) return;
    setClearing(true);
    setError(null);
    try {
      await logs.clear();
      saveScroll(0, true);
      setConfirming(false);
    } catch (cause) {
      setError(toIpcError(cause).payload);
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="ml-auto flex items-center gap-1">
          {!following ? (
            <Button
              variant="ghost"
              size="icon-sm"
              density="adaptive"
              className="hidden md:inline-flex"
              onClick={onLatest}
              aria-label={t({
                comment: "跳到运行期日志列表顶部并恢复跟随",
                message: "最新",
              })}
            >
              <ArrowUp />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            disabled={logs.loading}
            aria-label={t`刷新`}
            onClick={() => {
              logs.refresh();
            }}
          >
            <RefreshCw />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                density="adaptive"
                aria-label={t({
                  comment: "统一日志工具栏的刷新、跟随和清理菜单",
                  message: "日志操作",
                })}
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="ui-density-adaptive">
              <DropdownMenuGroup>
                <DropdownMenuCheckboxItem
                  checked={following}
                  onCheckedChange={(checked) => {
                    if (checked) onLatest();
                    else
                      saveScroll(
                        useActivityViewStore.getState().scrollTop,
                        false,
                      );
                  }}
                >
                  <Trans comment="日志菜单选项，持续滚动到新记录">
                    跟随最新
                  </Trans>
                </DropdownMenuCheckboxItem>
                <DropdownMenuItem
                  disabled={logs.loading}
                  onSelect={() => void openDirectory()}
                >
                  <FolderOpen />
                  <Trans comment="打开应用专属日志文件夹">打开日志文件夹</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={logs.loading}
                  variant="destructive"
                  onSelect={() => {
                    setError(null);
                    setConfirming(true);
                  }}
                >
                  <Trans comment="清理统一日志文件和当前活动日志">
                    清空日志
                  </Trans>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!clearing) setConfirming(open);
        }}
      >
        <AlertDialogContent className="ui-density-adaptive">
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans comment="手动清理统一日志文件的确认标题">清空日志？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                当前日志文件和活动日志会被移除，正在运行的任务不受影响。
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p
              role="alert"
              className="text-destructive text-sm wrap-break-word"
            >
              {describeError(error, t)}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={clearing}
              onClick={(event) => {
                event.preventDefault();
                void clear();
              }}
            >
              <Trans comment="确认清空当前运行期日志的按钮">清空</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
