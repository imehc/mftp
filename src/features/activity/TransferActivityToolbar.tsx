import { Trans, useLingui } from "@lingui/react/macro";
import { Ellipsis, ListFilter, Trash2 } from "lucide-react";
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
import {
  DropdownMenu,
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
import { useTransfersStore } from "~/store/transfers";

import {
  type TransferFilter,
  useActivityViewStore,
} from "./activity-view-store";

export default function TransferActivityToolbar() {
  const { t, i18n } = useLingui();
  const transfers = useTransfersStore((state) => state.transfers);
  const clearFinished = useTransfersStore((state) => state.clearFinished);
  const filter = useActivityViewStore((state) => state.transferFilter);
  const setFilter = useActivityViewStore((state) => state.setTransferFilter);
  const [confirming, setConfirming] = useState(false);
  const options = [
    {
      value: "running",
      label: t`进行中`,
      count: transfers.filter((item) => item.status === "running").length,
    },
    {
      value: "error",
      label: t`失败`,
      count: transfers.filter((item) => item.status === "error").length,
    },
    {
      value: "finished",
      label: t`已结束`,
      count: transfers.filter(
        (item) => item.status === "success" || item.status === "cancelled",
      ).length,
    },
  ];
  const changeFilter = (value: string) => setFilter(value as TransferFilter);
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Select value={filter} onValueChange={changeFilter}>
          <SelectTrigger
            density="adaptive"
            className="hidden w-fit min-w-32 md:flex"
            aria-label={t({
              comment: "活动任务页的状态筛选控件",
              message: "筛选任务",
            })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span>{option.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {i18n.number(option.count)}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              density="adaptive"
              className="ml-auto"
              aria-label={t({
                comment: "活动任务工具栏的状态筛选与清除菜单",
                message: "任务操作",
              })}
            >
              <ListFilter className="md:hidden" />
              <Ellipsis className="hidden md:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="ui-density-adaptive">
            <DropdownMenuRadioGroup
              value={filter}
              onValueChange={changeFilter}
              className="md:hidden"
            >
              {options.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                  <span className="text-muted-foreground ml-auto tabular-nums">
                    {i18n.number(option.count)}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator className="md:hidden" />
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={!options[2].count}
                onSelect={() => setConfirming(true)}
              >
                <Trash2 />
                <Trans>清除已结束</Trans>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="ui-density-adaptive">
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans comment="活动任务工具栏清除已结束任务的确认标题">
                清除已结束的任务？
              </Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans comment="明确任务清理不影响日志或运行中的任务">
                仅移除已完成或取消的任务，正在运行的任务和日志不受影响。
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={clearFinished}>
              <Trans>清除已结束</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
