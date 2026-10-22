import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { ArrowDown, Ellipsis, History } from "lucide-react";
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useActivityViewStore } from "~/features/activity/activity-view-store";
import { describeError, toIpcError } from "~/lib/errors";

import type { ExecutionLogs } from "./use-execution-logs";

export default function ExecutionLogToolbar({ logs }: { logs: ExecutionLogs }) {
  const { t } = useLingui();
  const { filter, setFilter, following, saveScroll } = useActivityViewStore();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const onLatest = () =>
    saveScroll(useActivityViewStore.getState().scrollTop, true);
  const options = [
    {
      value: "all",
      label: t({
        comment: "运行期日志筛选，包含成功失败和运行中",
        message: "全部记录",
      }),
    },
    {
      value: "failed",
      label: t({
        comment: "运行期日志筛选，仅保留失败和中断操作",
        message: "仅看失败",
      }),
    },
  ];
  const changeFilter = (value: string) =>
    setFilter(value === "failed" ? "failed" : "all");

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
        <Select value={filter} onValueChange={changeFilter}>
          <SelectTrigger
            density="adaptive"
            className="hidden w-fit min-w-32 md:flex"
            aria-label={t`筛选日志`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-1">
          {!following ? (
            <Button
              variant="ghost"
              size="icon-sm"
              density="adaptive"
              className="hidden md:inline-flex"
              onClick={onLatest}
              aria-label={t({
                comment: "跳到运行期日志列表末尾并恢复跟随",
                message: "最新",
              })}
            >
              <ArrowDown />
            </Button>
          ) : null}
          <Button asChild variant="ghost" size="icon-sm" density="adaptive">
            <Link to="/logs" aria-label={t`历史日志`} title={t`历史日志`}>
              <History />
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                density="adaptive"
                aria-label={t({
                  comment: "运行期日志工具栏的筛选、跟随和清空菜单",
                  message: "日志操作",
                })}
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="ui-density-adaptive">
              <DropdownMenuRadioGroup
                value={filter}
                onValueChange={changeFilter}
                className="md:hidden"
              >
                {options.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator className="md:hidden" />
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
                  disabled={!logs.operations.length}
                  variant="destructive"
                  onSelect={() => {
                    setError(null);
                    setConfirming(true);
                  }}
                >
                  <Trans comment="只清空内存日志，不删除持久历史">
                    清空当前日志
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
              <Trans comment="手动清空运行期日志的确认标题">
                清空当前日志？
              </Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                当前日志详情会被移除，历史日志和正在运行的任务不受影响。
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
