import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { CircleAlert, Clock, LoaderCircle, X } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { describeError, hasCustomCode } from "~/lib/errors";
import { formatBytes } from "~/lib/format";
import type { PoetryCollectionStatus } from "~/types";

import type { PoetrySyncProgressState } from "../sync-progress";

interface PoetrySyncStatusProps {
  progress: PoetrySyncProgressState;
  collections: PoetryCollectionStatus[];
  starting?: boolean;
  className?: string;
  onCancel: () => void | Promise<void>;
}

/** 数据管理页与活动中心共用的同步状态块；失败只提示一次，取消不算失败。 */
export default function PoetrySyncStatus({
  progress,
  collections,
  starting = false,
  className,
  onCancel,
}: PoetrySyncStatusProps) {
  const { t } = useLingui();
  const [dismissedAt, setDismissedAt] = useState(() =>
    progress.phase === "error" ? progress.updatedAt : 0,
  );
  const [cancelling, setCancelling] = useState(false);
  const cancelled = hasCustomCode(progress.error, "poetry:sync_cancelled");
  const failed =
    progress.phase === "error" && !progress.active && !starting && !cancelled;
  const visible =
    progress.active ||
    starting ||
    (failed && dismissedAt !== progress.updatedAt);
  if (!visible) return null;
  const label = progress.stale
    ? t`等待确认`
    : starting
      ? t`正在启动`
      : failed
        ? t`同步失败`
        : progress.phase === "verifying"
          ? t`正在校验`
          : progress.phase === "importing" || progress.phase === "indexing"
            ? t`正在导入`
            : progress.phase === "downloading"
              ? t`正在下载`
              : t`正在同步`;
  const importing =
    progress.phase === "importing" || progress.phase === "indexing";
  const total = importing ? progress.total : progress.bytesTotal;
  const done = importing ? progress.imported : progress.bytesDone;
  const percent =
    total && total > 0
      ? Math.min(100, Math.max(0, (done / total) * 100))
      : undefined;
  const doneLabel = importing ? done.toLocaleString() : formatBytes(done);
  const totalLabel = total
    ? importing
      ? total.toLocaleString()
      : formatBytes(total)
    : null;
  const name = collections.find(
    (item) => item.id === progress.collectionId,
  )?.name;
  const errorText = progress.error ? describeError(progress.error, t) : null;

  const cancel = async () => {
    setCancelling(true);
    try {
      await onCancel();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <section
      role={failed ? "alert" : undefined}
      className={cn(
        "bg-card flex flex-col gap-2 rounded-xl border p-3",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        {failed ? (
          <CircleAlert
            aria-hidden
            className="text-destructive mt-0.5 size-4 shrink-0"
          />
        ) : progress.stale ? (
          <Clock
            aria-hidden
            className="text-muted-foreground mt-0.5 size-4 shrink-0"
          />
        ) : (
          <LoaderCircle
            aria-hidden
            className="text-muted-foreground mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="text-sm font-semibold">{label}</h2>
            {name ? (
              <span className="text-muted-foreground min-w-0 truncate text-xs">
                {name}
              </span>
            ) : null}
          </div>
          {failed && errorText ? (
            <p className="text-destructive mt-1 text-xs wrap-break-word">
              {errorText}
            </p>
          ) : null}
        </div>
        {progress.active ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={cancelling}
            onClick={() => void cancel()}
          >
            {cancelling ? (
              <LoaderCircle
                data-icon="inline-start"
                aria-hidden
                className="animate-spin motion-reduce:animate-none"
              />
            ) : null}
            <Trans>取消同步</Trans>
          </Button>
        ) : failed ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label={t`关闭同步失败提示`}
            title={t`关闭同步失败提示`}
            onClick={() => setDismissedAt(progress.updatedAt)}
          >
            <X />
          </Button>
        ) : null}
      </div>
      {!failed ? (
        <div className="flex flex-col gap-1">
          <Progress
            value={percent}
            aria-label={t`诗词同步进度`}
            className={percent === undefined ? "animate-pulse" : undefined}
          />
          <div className="text-muted-foreground flex justify-between gap-2 text-xs tabular-nums">
            <span className="min-w-0 truncate">
              {doneLabel}
              {totalLabel ? ` / ${totalLabel}` : ""}
            </span>
            {percent !== undefined ? <span>{Math.round(percent)}%</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
