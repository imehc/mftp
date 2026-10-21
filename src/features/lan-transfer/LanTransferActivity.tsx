import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { XCircle } from "lucide-react";
import { useRef, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Progress } from "~/components/ui/progress";
import { translate } from "~/i18n/translate";
import { describeError } from "~/lib/errors";
import { formatBytes, formatDuration } from "~/lib/format";
import { useVirtualizerFontSize } from "~/lib/root-font-size";
import { TOUCH_TARGET_CLASS } from "~/lib/touch";
import type { LanTransferTask } from "~/types";

import LanConfirmDialog from "./LanConfirmDialog";

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
    return formatDuration((task.updatedAt - task.startedAt) / 1000);
  }
  const speed = taskSpeed(task);
  if (speed <= 0 || task.total <= task.transferred) return "--";
  return formatDuration((task.total - task.transferred) / speed);
}

export default function LanTransferActivity({
  tasks,
  cancelTask,
}: {
  tasks: LanTransferTask[];
  cancelTask: (id: string) => void;
}) {
  const { t } = useLingui();
  const [pending, setPending] = useState<LanTransferTask | null>(null);
  const pendingName = pending?.fileName ?? "";
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scroller.current,
    getItemKey: (index) => tasks[index].id,
    estimateSize: () => 112,
    overscan: 3,
  });
  useVirtualizerFontSize(virtualizer);
  return (
    <>
      <section className="border-border bg-card shrink-0 rounded-xl border p-3">
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
          <Empty className="min-h-20 gap-0 border border-dashed p-3">
            <EmptyHeader>
              <EmptyTitle className="text-muted-foreground text-xs font-normal">
                <Trans>暂无任务</Trans>
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
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
                    : null;
                const speed = taskSpeed(task);
                const taskEtaValue = taskEta(task);
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
                            className={TOUCH_TARGET_CLASS}
                            onClick={() => setPending(task)}
                          >
                            <XCircle className="text-destructive" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <Progress
                      className={
                        percent === null ? "mt-1 animate-pulse" : "mt-1"
                      }
                      value={percent ?? undefined}
                      aria-label={t`传输进度`}
                    />
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
                          : t`耗时 ${taskEtaValue}`}
                      </span>
                    </div>
                    {task.error ? (
                      <p
                        role="alert"
                        className="text-destructive mt-1 text-xs wrap-anywhere"
                      >
                        {describeError(task.error, t)}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
      <LanConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={t`取消传输`}
        description={
          <>
            {t`取消“${pendingName}”的传输？`}
            <span className="mt-2 block">
              <Trans>任务会立即停止，之后需要重新发起。</Trans>
            </span>
          </>
        }
        confirmLabel={t`取消传输`}
        onConfirm={() => {
          if (pending) void cancelTask(pending.id);
        }}
      />
    </>
  );
}
