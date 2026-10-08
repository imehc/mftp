import { Trans, useLingui } from "@lingui/react/macro";
import {
  FolderOpen,
  ListTree,
  Magnet,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
  Send,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";
import { useTransfersStore } from "~/store/transfers";
import type { BtTaskInfo } from "~/types";

export type BtControlAction = "Pause" | "Resume" | "Cancel";

export interface TaskRowProps {
  task: BtTaskInfo;
  stalled: boolean;
  busy?: boolean;
  hasParsedProbe: boolean;
  onOpenParsed: (task: BtTaskInfo) => void;
  onRetry: (task: BtTaskInfo) => void;
  onPeers: (task: BtTaskInfo) => void;
  onControl: (task: BtTaskInfo, action: BtControlAction) => void;
  onMagnet: (task: BtTaskInfo) => void;
  onExport: (task: BtTaskInfo) => void;
  onOpenFiles: (task: BtTaskInfo) => void;
  onDelete: (task: BtTaskInfo) => void;
}

/** 两端采用同一任务卡片结构；次要动作收进菜单，不挤占状态与速率行。 */
export default function TaskRow({
  task,
  stalled,
  busy,
  hasParsedProbe,
  onOpenParsed,
  onRetry,
  onPeers,
  onControl,
  onMagnet,
  onExport,
  onOpenFiles,
  onDelete,
}: TaskRowProps) {
  const { t } = useLingui();
  const speed = useTransfersStore(
    (s) => s.transfers.find((item) => item.id === `bt:${task.infoHash}`)?.speed,
  );
  const total = task.total ?? 0;
  const progress = task.progress ?? 0;
  const terminal = task.finished || task.status === "Cancelled";
  const percent =
    total > 0
      ? Math.max(0, Math.min(100, Math.round((progress / total) * 100)))
      : null;
  const running =
    task.state === "Downloading" ||
    task.state === "Initializing" ||
    task.state === "Seeding";
  const controllable =
    !terminal && task.status !== "Error" && task.status !== "Packaging";
  const status =
    task.status === "Cancelled"
      ? t`已取消`
      : task.status === "Error"
        ? t`错误`
        : task.status === "Packaging"
          ? t`正在整理文件`
          : task.status === "Completed"
            ? t`已完成`
            : task.state === "Initializing"
              ? t`获取资源信息…`
              : task.state === "Paused"
                ? t`已暂停`
                : task.state === "Seeding"
                  ? t`做种中`
                  : task.state === "Downloading"
                    ? stalled
                      ? t`暂无可用节点`
                      : t`下载中`
                    : t`未运行`;
  return (
    <article className="bg-card overflow-hidden rounded-xl border text-sm">
      <div className="flex flex-col gap-2 p-3">
        <button
          type="button"
          className="min-w-0 text-left font-medium break-words hover:underline"
          title={task.label}
          onClick={() => onOpenFiles(task)}
        >
          {task.label}
        </button>
        <div className="flex items-center justify-between gap-3 text-xs tabular-nums">
          <span>
            {total > 0
              ? `${formatBytes(progress)} / ${formatBytes(total)}`
              : status}
          </span>
          {percent !== null ? (
            <span className="font-semibold">{percent}%</span>
          ) : null}
        </div>
        <div
          role="progressbar"
          aria-label={t`下载进度`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          className="bg-muted h-1 overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full rounded-full"
            style={{ width: `${percent ?? 0}%` }}
          />
        </div>
        {task.error ? (
          <p className="text-destructive text-xs break-words">
            {describeError(task.error)}
          </p>
        ) : null}
      </div>
      <div className="flex min-h-11 items-center gap-2 border-t px-2">
        <p className="text-muted-foreground min-w-0 flex-1 text-xs break-words">
          {status}
          {task.state === "Downloading" &&
          !terminal &&
          speed != null &&
          speed > 0
            ? ` · ${formatBytes(speed)}/s`
            : ""}
        </p>
        {controllable ? (
          <Button
            variant="ghost"
            density="adaptive"
            size="icon-sm"
            disabled={busy}
            aria-label={running ? t`暂停` : t`继续`}
            onClick={() => onControl(task, running ? "Pause" : "Resume")}
          >
            {running ? <Pause /> : <Play />}
          </Button>
        ) : task.status === "Error" ? (
          <Button
            variant="ghost"
            density="adaptive"
            size="icon-sm"
            disabled={busy}
            aria-label={t`重试`}
            onClick={() => onRetry(task)}
          >
            <RotateCcw />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          density="adaptive"
          size="icon-sm"
          aria-label={t`打开文件或目录`}
          onClick={() => onOpenFiles(task)}
        >
          <FolderOpen />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              density="adaptive"
              size="icon-sm"
              aria-label={t`更多操作`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="ui-density-adaptive">
            <DropdownMenuItem onSelect={() => onPeers(task)}>
              <Users />
              <Trans>查看节点明细</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onMagnet(task)}>
              <Magnet />
              <Trans>磁力链接</Trans>
            </DropdownMenuItem>
            {hasParsedProbe ? (
              <DropdownMenuItem onSelect={() => onOpenParsed(task)}>
                <ListTree />
                <Trans>查看资源信息</Trans>
              </DropdownMenuItem>
            ) : null}
            {task.status === "Completed" && !task.exported ? (
              <DropdownMenuItem disabled={busy} onSelect={() => onExport(task)}>
                <Send />
                <Trans>复制到用户目录</Trans>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            {!terminal ? (
              <DropdownMenuItem
                disabled={busy}
                onSelect={() => onControl(task, "Cancel")}
              >
                <XCircle />
                <Trans>取消</Trans>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              disabled={busy}
              variant="destructive"
              onSelect={() => onDelete(task)}
            >
              <Trash2 />
              <Trans>删除</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
