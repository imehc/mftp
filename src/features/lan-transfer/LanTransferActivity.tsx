import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { msg } from "@lingui/core/macro";
import { XCircle } from "lucide-react";
import { translate } from "~/i18n/translate";
import { formatBytes } from "~/lib/format";
import { describeError } from "~/lib/errors";
import type { LanTransferTask } from "~/types";
function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${restSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}h ${restMinutes}m`;
}
function taskStatusLabel(value: string) {
  if (value === "running") return translate(msg`进行中`);
  if (value === "success") return translate(msg`完成`);
  if (value === "failed") return translate(msg`失败`);
  if (value === "canceled") return translate(msg`已取消`);
  return value;
}
function taskDirectionLabel(value: string) {
  if (value === "upload") return translate(msg`上传`);
  if (value === "download") return translate(msg`下载`);
  return value;
}
function taskSpeed(task: LanTransferTask) {
  const elapsedMs = Math.max(0, task.updatedAt - task.startedAt);
  if (elapsedMs <= 0 || task.transferred <= 0) return 0;
  return task.transferred / (elapsedMs / 1000);
}
function taskEta(task: LanTransferTask) {
  if (task.status !== "running") {
    return formatDuration(task.updatedAt - task.startedAt);
  }
  const speed = taskSpeed(task);
  if (speed <= 0 || task.total <= task.transferred) return "-";
  return formatDuration(((task.total - task.transferred) / speed) * 1000);
}
export default function LanTransferActivity({
  tasks,
  cancelTask,
}: {
  tasks: LanTransferTask[];
  cancelTask: (id: string) => void;
}) {
  const { t } = useLingui();
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scroller.current,
    getItemKey: (index) => tasks[index].id,
    estimateSize: () => 112,
    overscan: 3,
  });
  return (
    <section className="border-border bg-card shrink-0 rounded-lg border p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          <Trans>传输活动</Trans>
        </h2>
        <Badge variant="outline">
          <Plural
            value={{
              taskCount: tasks.length,
            }}
            one="# 任务"
            other="# 任务"
          />
        </Badge>
      </div>
      {tasks.length === 0 ? (
        <div className="border-border text-muted-foreground flex min-h-20 items-center justify-center rounded-md border border-dashed text-xs">
          <Trans>暂无任务</Trans>
        </div>
      ) : (
        <div ref={scroller} className="max-h-80 overflow-auto">
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const task = tasks[row.index];
              const percent =
                task.total > 0
                  ? Math.min(
                      100,
                      Math.round((task.transferred / task.total) * 100),
                    )
                  : 0;
              const speed = taskSpeed(task);
              const taskEtaValue = taskEta(task);
              const taskEtaValue2 = taskEta(task);
              return (
                <div
                  key={task.id}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  style={{ transform: `translateY(${row.start}px)` }}
                  className="border-border absolute top-0 left-0 w-full border-b px-1 py-3"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium">
                      {taskDirectionLabel(task.direction)} · {task.fileName}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-muted-foreground">
                        {taskStatusLabel(task.status)}
                      </span>
                      {task.status === "running" ? (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title={t`取消传输`}
                          aria-label={t`取消传输`}
                          className="max-md:min-h-11 max-md:min-w-11"
                          onClick={() => void cancelTask(task.id)}
                        >
                          <XCircle className="text-destructive" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full"
                      style={{
                        width: `${percent}%`,
                      }}
                    />
                  </div>
                  <div className="text-muted-foreground mt-1 flex items-center justify-between gap-2 text-xs">
                    <span>{task.ip}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatBytes(task.transferred)} /{" "}
                      {formatBytes(task.total)}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-0.5 flex items-center justify-between gap-2 text-xs">
                    <span className="tabular-nums">
                      {speed > 0 ? `${formatBytes(speed)}/s` : "-"}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {task.status === "running"
                        ? t`剩余 ${taskEtaValue}`
                        : t`耗时 ${taskEtaValue2}`}
                    </span>
                  </div>
                  {task.error ? (
                    <p className="text-destructive mt-1 text-xs wrap-anywhere">
                      {describeError(task.error)}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
