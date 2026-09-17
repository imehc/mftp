import { Trans, useLingui } from "@lingui/react/macro";
import {
  HardDriveDownload,
  Magnet,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import type { BtFileMeta, BtTaskInfo } from "~/types";
import { formatBytes } from "~/lib/format";
import { isPreviewable, previewKind } from "~/lib/preview-kind";
import { Button } from "~/components/ui/button";

/** 控制动作，与 `ipc.btControl` 的取值一致。 */
export type BtControlAction = "Pause" | "Resume" | "Cancel";

interface TaskRowProps {
  task: BtTaskInfo;
  /** 引擎在下载但连不上节点，徽标改为提示。 */
  stalled: boolean;
  onPrefill: (task: BtTaskInfo) => void;
  onOpenFile: (task: BtTaskInfo, file: BtFileMeta) => void;
  onPeers: (task: BtTaskInfo) => void;
  onSave: (task: BtTaskInfo, fileIndex: number) => void;
  onControl: (task: BtTaskInfo, action: BtControlAction) => void;
  onMagnet: (task: BtTaskInfo) => void;
  onDelete: (task: BtTaskInfo) => void;
}

/** 任务列表的一行：标题、状态徽标、进度与操作按钮。 */
export default function TaskRow({
  task,
  stalled,
  onPrefill,
  onOpenFile,
  onPeers,
  onSave,
  onControl,
  onMagnet,
  onDelete,
}: TaskRowProps) {
  const { t } = useLingui();
  const total = task.total ?? 0;
  const progress = task.progress ?? 0;
  const terminal = task.finished || task.status === "Cancelled";
  const percent =
    total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0;
  // 引擎里确实有这个任务；state 为空说明引擎还没起来或句柄尚未恢复，
  // 此时不该摆出 0 B / 0 B 冒充下载中。
  const live = !terminal && task.state != null;
  const running =
    task.state === "Downloading" ||
    task.state === "Initializing" ||
    task.state === "Seeding";
  const controllable =
    !terminal &&
    task.status !== "Cancelled" &&
    task.status !== "Error" &&
    task.status !== "Packaging";
  // 预览任务才带选中文件；缓存还在时才有打开 / 下载的意义。
  const cached = task.mode === "preview" && task.cacheAvailable;
  const openable = cached
    ? task.files.find((file) => isPreviewable(previewKind(file.path)))
    : undefined;
  const savable = cached ? task.files[0] : undefined;
  return (
    <div className="hover:bg-sidebar-accent flex flex-col gap-1 rounded-md px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
          title={task.label}
          onClick={() => onPrefill(task)}
        >
          {task.label}
        </button>
        {task.mode === "preview" ? (
          <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1 py-px text-[10px]">
            <Trans>在线预览</Trans>
          </span>
        ) : null}
        {task.mode === "preview" && !task.cacheAvailable ? (
          <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1 py-px text-[10px]">
            <Trans>缓存已清理</Trans>
          </span>
        ) : null}
        {task.status === "Cancelled" ? (
          <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1 py-px text-[10px]">
            <Trans>已取消</Trans>
          </span>
        ) : null}
        {task.status === "Error" ? (
          <span
            className="bg-muted text-destructive shrink-0 rounded-sm px-1 py-px text-[10px]"
            title={task.error ?? undefined}
          >
            <Trans>错误</Trans>
          </span>
        ) : null}
        {terminal || task.status === "Error" ? null : (
          <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1 py-px text-[10px]">
            {task.state === "Initializing" ? (
              <Trans>获取资源信息…</Trans>
            ) : task.state === "Paused" ? (
              <Trans>已暂停</Trans>
            ) : task.state === "Seeding" ? (
              <Trans>做种中</Trans>
            ) : task.state === "Downloading" ? (
              stalled ? (
                <Trans>暂无可用节点</Trans>
              ) : (
                <Trans>下载中</Trans>
              )
            ) : (
              <Trans>未运行</Trans>
            )}
          </span>
        )}
        {terminal ? (
          <span className="text-muted-foreground shrink-0 tabular-nums">
            {formatBytes(total)}
          </span>
        ) : live && total > 0 ? (
          <>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground shrink-0 tabular-nums hover:underline"
              title={t`查看节点明细`}
              onClick={() => onPeers(task)}
            >
              {t`节点`} {task.peersLive}
            </button>
            <span className="shrink-0 font-medium tabular-nums">
              {formatBytes(progress)} / {formatBytes(total)}
            </span>
          </>
        ) : null}
        {openable ? (
          <Button
            variant="ghost"
            size="icon-xs"
            title={t`打开`}
            aria-label={t`打开`}
            onClick={() => onOpenFile(task, openable)}
          >
            <Play />
          </Button>
        ) : null}
        {savable ? (
          <Button
            variant="ghost"
            size="icon-xs"
            title={t`下载`}
            aria-label={t`下载`}
            disabled={task.pinned}
            onClick={() => onSave(task, savable.index)}
          >
            <HardDriveDownload />
          </Button>
        ) : null}
        {controllable ? (
          <Button
            variant="ghost"
            size="icon-xs"
            title={running ? t`暂停` : t`继续`}
            aria-label={running ? t`暂停` : t`继续`}
            onClick={() => onControl(task, running ? "Pause" : "Resume")}
          >
            {running ? <Pause /> : <Play />}
          </Button>
        ) : null}
        {task.status === "Error" ? (
          <Button
            variant="ghost"
            size="icon-xs"
            title={t`重试`}
            aria-label={t`重试`}
            onClick={() => onPrefill(task)}
          >
            <RotateCcw />
          </Button>
        ) : null}
        {!terminal && task.mode !== "preview" && task.status !== "Cancelled" ? (
          <Button
            variant="ghost"
            size="icon-xs"
            title={t`取消`}
            aria-label={t`取消`}
            onClick={() => onControl(task, "Cancel")}
          >
            <XCircle />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          title={t`磁力链接`}
          aria-label={t`磁力链接`}
          onClick={() => onMagnet(task)}
        >
          <Magnet />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title={t`删除`}
          aria-label={t`删除`}
          disabled={task.pinned}
          onClick={() => onDelete(task)}
        >
          <Trash2 />
        </Button>
      </div>
      {terminal ? null : (
        <div className="bg-muted h-0.5 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-[width]"
            style={{
              width: `${percent}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}
