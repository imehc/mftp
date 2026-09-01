import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { listen } from "@tauri-apps/api/event";
import { gsap } from "gsap";
import {
  CheckCircle2,
  ChevronDown,
  ListChecks,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import type { TransferProgress } from "~/types";
import * as ipc from "~/lib/ipc";
import { cn } from "~/lib/utils";
import { formatBytes } from "~/lib/format";
import { prefersReducedMotion } from "~/lib/motion";
import { TRANSFER_PROGRESS } from "~/lib/events";
import { type TransferState, useTransfersStore } from "~/store/transfers";
import { Button } from "~/components/ui/button";
import { translate } from "~/i18n/translate";
function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  const rounded = Math.ceil(seconds);
  if (rounded < 60) {
    return translate(
      msg({
        message: plural(
          {
            rounded,
          },
          {
            one: "# 秒",
            other: "# 秒",
          },
        ),
      }),
    );
  }
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) {
    if (remainingSeconds > 0) {
      return translate(
        msg({
          message: plural(
            {
              minutes,
            },
            {
              one: `# 分 ${remainingSeconds} 秒`,
              other: `# 分 ${remainingSeconds} 秒`,
            },
          ),
        }),
      );
    }
    return translate(
      msg({
        message: plural(
          {
            minutes,
          },
          {
            one: "# 分",
            other: "# 分",
          },
        ),
      }),
    );
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes > 0) {
    return translate(
      msg({
        message: plural(
          {
            hours,
          },
          {
            one: `# 小时 ${remainingMinutes} 分`,
            other: `# 小时 ${remainingMinutes} 分`,
          },
        ),
      }),
    );
  }
  return translate(
    msg({
      message: plural(
        {
          hours,
        },
        {
          one: "# 小时",
          other: "# 小时",
        },
      ),
    }),
  );
}
function transferMetrics(progress: TransferState) {
  const total = progress.total ?? 0;
  const percent =
    total > 0
      ? Math.min(100, Math.round((progress.transferred / total) * 100))
      : null;
  const speed = progress.speed && progress.speed > 0 ? progress.speed : null;
  const eta =
    progress.status === "running" && !progress.paused && total > 0 && speed
      ? formatDuration((total - progress.transferred) / speed)
      : null;
  return {
    percent,
    size:
      total > 0
        ? `${formatBytes(progress.transferred)} / ${formatBytes(total)}`
        : progress.transferred
          ? formatBytes(progress.transferred)
          : null,
    speed: speed ? formatSpeed(speed) : null,
    eta,
  };
}
export interface TransferPanelProps {
  animateOnMount?: boolean;
}
export default function TransferPanel({
  animateOnMount = true,
}: TransferPanelProps) {
  const { t } = useLingui();
  const contentRef = useRef<HTMLDivElement>(null);
  const transfers = useTransfersStore((s) => s.transfers);
  const updateProgressBatch = useTransfersStore((s) => s.updateProgressBatch);
  const markCancelling = useTransfersStore((s) => s.markCancelling);
  const cancelFailed = useTransfersStore((s) => s.cancelFailed);
  const finishTransfer = useTransfersStore((s) => s.finish);
  const setPaused = useTransfersStore((s) => s.setPaused);
  const setControlPending = useTransfersStore((s) => s.setControlPending);
  const setControlError = useTransfersStore((s) => s.setControlError);
  const setRetrying = useTransfersStore((s) => s.setRetrying);
  const clearFinished = useTransfersStore((s) => s.clearFinished);
  const [open, setOpen] = useState(true);
  const animationEnabledRef = useRef(animateOnMount);
  const activeTransferCount = transfers.filter(
    (t) => t.status === "running",
  ).length;
  const pausedTransferCount = transfers.filter(
    (t) => t.status === "running" && t.paused,
  ).length;
  const transferringCount = activeTransferCount - pausedTransferCount;
  const finishedTransferCount = transfers.length - activeTransferCount;
  const latestTransfer =
    transfers.find((t) => t.status === "running") ?? transfers[0];
  const latestMetrics = latestTransfer ? transferMetrics(latestTransfer) : null;
  const transferStatusLabel =
    activeTransferCount === 0
      ? t`空闲`
      : transferringCount === 0
        ? t({
            message: plural(
              {
                pausedTransferCount,
              },
              {
                one: "# 个已暂停",
                other: "# 个已暂停",
              },
            ),
          })
        : pausedTransferCount > 0
          ? t({
              message: plural(
                {
                  transferringCount,
                },
                {
                  one: `# 个进行中 · ${pausedTransferCount} 个已暂停`,
                  other: `# 个进行中 · ${pausedTransferCount} 个已暂停`,
                },
              ),
            })
          : t({
              message: plural(
                {
                  transferringCount,
                },
                {
                  one: "# 个进行中",
                  other: "# 个进行中",
                },
              ),
            });
  const clearFinishedLabel = t({
    message: plural(
      {
        finishedTransferCount,
      },
      {
        one: "清除 # 个已完成任务",
        other: "清除 # 个已完成任务",
      },
    ),
  });
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingProgress = new Map<string, TransferProgress>();
    const flushProgress = () => {
      flushTimer = null;
      if (pendingProgress.size === 0) return;
      const updates = Array.from(pendingProgress.values());
      pendingProgress.clear();
      updateProgressBatch(updates);
    };
    void listen<TransferProgress>(TRANSFER_PROGRESS, (event) => {
      pendingProgress.set(event.payload.id, event.payload);
      if (!flushTimer) {
        flushTimer = setTimeout(flushProgress, 100);
      }
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else dispose = unlisten;
    });
    return () => {
      cancelled = true;
      if (flushTimer) clearTimeout(flushTimer);
      pendingProgress.clear();
      dispose?.();
    };
  }, [updateProgressBatch]);
  // 传输进行中时自动展开；放在渲染阶段调整（React 的
  // “在 prop 变化时调整 state”模式），而不是用 effect。
  const [prevActiveCount, setPrevActiveCount] = useState(activeTransferCount);
  if (prevActiveCount !== activeTransferCount) {
    setPrevActiveCount(activeTransferCount);
    if (activeTransferCount > 0) setOpen(true);
  }
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    gsap.killTweensOf(content);
    const reduceMotion = prefersReducedMotion();
    if (reduceMotion || !animationEnabledRef.current) {
      gsap.set(content, {
        display: open ? "block" : "none",
        clearProps: "height,opacity,transform",
      });
      return;
    }
    if (open) {
      gsap.set(content, {
        display: "block",
        height: "auto",
      });
      const height = content.offsetHeight;
      gsap.fromTo(
        content,
        {
          height: 0,
          opacity: 0,
          y: -6,
        },
        {
          height,
          opacity: 1,
          y: 0,
          duration: 0.34,
          ease: "power3.out",
          onComplete: () =>
            gsap.set(content, {
              height: "auto",
            }),
        },
      );
    } else {
      gsap.to(content, {
        height: 0,
        opacity: 0,
        y: -4,
        duration: 0.22,
        ease: "power2.inOut",
        onComplete: () =>
          gsap.set(content, {
            display: "none",
          }),
      });
    }
    return () => gsap.killTweensOf(content);
  }, [open]);
  const cancelTransfer = async (transfer: TransferState) => {
    const { id } = transfer;
    setControlError(id);
    markCancelling(id);
    try {
      if (id.startsWith("bt:")) {
        // 移除预览任务会清除其缓存文件；下载任务在取消时
        // 保留历史记录与用户目录下的文件。
        await ipc.btControl(
          id.slice(3),
          transfer.mode === "preview" ? "Remove" : "Cancel",
          transfer.mode === "preview",
        );
        finishTransfer(id, "cancelled");
      } else {
        await ipc.sftpCancelTransfer(id);
      }
    } catch (error) {
      cancelFailed(id);
      setControlError(id, String(error));
    }
  };
  const togglePause = async (transfer: TransferState) => {
    if (transfer.controlPending || transfer.cancelling) return;
    const { id } = transfer;
    setControlError(id);
    setControlPending(id, true);
    try {
      if (id.startsWith("bt:")) {
        await ipc.btControl(
          id.slice(3),
          transfer.paused ? "Resume" : "Pause",
          false,
        );
      } else if (transfer.paused) {
        await ipc.sftpResumeTransfer(id);
      } else {
        await ipc.sftpPauseTransfer(id);
      }
      setPaused(id, !transfer.paused);
    } catch (error) {
      setControlError(id, String(error));
    } finally {
      setControlPending(id, false);
    }
  };
  const retryTransfer = async (transfer: TransferState) => {
    if (!transfer.retry || transfer.retrying) return;
    setRetrying(transfer.id, true);
    try {
      await transfer.retry();
    } catch (error) {
      setControlError(transfer.id, String(error));
      setRetrying(transfer.id, false);
    }
  };
  if (transfers.length === 0) return null;
  return (
    <div className="border-border bg-sidebar border-t">
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          className="text-muted-foreground hover:bg-sidebar-accent flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs"
          onClick={() => {
            animationEnabledRef.current = true;
            setOpen((value) => !value);
          }}
          aria-expanded={open}
          aria-controls="transfer-panel-content"
        >
          {transferringCount > 0 ? (
            <RefreshCw className="size-3 animate-spin" />
          ) : pausedTransferCount > 0 ? (
            <Pause className="size-3" />
          ) : (
            <ListChecks className="size-3" />
          )}
          <span className="text-foreground font-medium">
            <Trans>传输</Trans>
          </span>
          <span className="shrink-0">{transferStatusLabel}</span>
          {latestTransfer && latestMetrics?.percent != null ? (
            <span className="min-w-0 flex-1 truncate tabular-nums">
              {latestTransfer.label} · {latestMetrics.percent}%
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <ChevronDown
            className={cn(
              "size-3 transition-transform duration-300 motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
        {finishedTransferCount > 0 ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={clearFinished}
            title={clearFinishedLabel}
            aria-label={clearFinishedLabel}
          >
            <Trash2 data-icon="inline-start" />
            <Trans>清除 {finishedTransferCount}</Trans>
          </Button>
        ) : null}
      </div>
      <div
        id="transfer-panel-content"
        ref={contentRef}
        className="overflow-hidden"
      >
        <div className="flex max-h-[min(16rem,32vh)] flex-col gap-2 overflow-y-auto px-2 pt-1 pb-2">
          {transfers.map((item) => (
            <TransferItem
              key={item.id}
              transfer={item}
              onCancel={() => void cancelTransfer(item)}
              onTogglePause={togglePause}
              onRetry={retryTransfer}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
const TransferItem = function TransferItem({
  transfer,
  onCancel,
  onTogglePause,
  onRetry,
}: {
  transfer: TransferState;
  onCancel: () => void;
  onTogglePause: (transfer: TransferState) => void;
  onRetry: (transfer: TransferState) => void;
}) {
  const { t } = useLingui();
  const total = transfer.total ?? 0;
  const progress =
    total > 0 ? Math.min(100, (transfer.transferred / total) * 100) : null;
  const metrics = transferMetrics(transfer);
  const statusIcon =
    transfer.status === "success" ? (
      <CheckCircle2 className="text-muted-foreground size-4 shrink-0" />
    ) : transfer.status === "cancelled" ? (
      <XCircle className="text-muted-foreground size-4 shrink-0" />
    ) : transfer.status === "error" ? (
      <XCircle className="text-destructive size-4 shrink-0" />
    ) : transfer.paused ? (
      <Pause className="text-muted-foreground size-4 shrink-0" />
    ) : (
      <RefreshCw className="text-muted-foreground size-4 shrink-0 animate-spin" />
    );
  const metricsEta = metrics.eta;
  return (
    <div className="border-border bg-background flex flex-col gap-1 rounded-md border px-2 py-2 text-xs">
      {/* 用 flex 而不是固定网格：BT 行会在标签旁追加来源 / 模式徽标，
          多余的网格子项会被换到单独一行。 */}
      <div className="flex items-center gap-2">
        {statusIcon}
        <span className="text-foreground min-w-0 flex-1 truncate font-medium">
          {transfer.label}
        </span>
        {transfer.source === "bt" ? (
          <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1 py-px text-[10px] font-medium">
            <Trans>BT</Trans>
          </span>
        ) : null}
        {transfer.source === "bt" && transfer.mode === "preview" ? (
          <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1 py-px text-[10px]">
            <Trans>在线预览</Trans>
          </span>
        ) : null}
        {transfer.status === "running" && transfer.cancellable !== false ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              title={transfer.paused ? t`继续` : t`暂停`}
              onClick={() => onTogglePause(transfer)}
              disabled={transfer.controlPending || transfer.cancelling}
            >
              {transfer.controlPending ? (
                <LoaderCircle className="animate-spin" />
              ) : transfer.paused ? (
                <Play />
              ) : (
                <Pause />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              title={t`取消`}
              onClick={() => onCancel()}
              disabled={transfer.cancelling || transfer.controlPending}
            >
              {transfer.cancelling ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <XCircle />
              )}
            </Button>
          </div>
        ) : transfer.status === "error" && transfer.retry ? (
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0"
            title={t`重试`}
            onClick={() => onRetry(transfer)}
            disabled={transfer.retrying}
          >
            {transfer.retrying ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            <Trans>重试</Trans>
          </Button>
        ) : null}
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
        <span className="text-foreground font-medium">{transfer.phase}</span>
        {metrics.percent !== null ? <span>{metrics.percent}%</span> : null}
        {metrics.size ? <span>{metrics.size}</span> : null}
        {metrics.speed ? <span>{metrics.speed}</span> : null}
        {metrics.eta ? (
          <span>
            <Trans>剩余 {metricsEta}</Trans>
          </span>
        ) : null}
      </div>
      {progress !== null ? (
        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-[width]"
            style={{
              width: `${progress}%`,
            }}
          />
        </div>
      ) : transfer.status === "running" && !transfer.paused ? (
        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
          <div className="bg-primary/70 animate-in slide-in-from-left-full h-full w-1/3 rounded-full duration-700" />
        </div>
      ) : null}
      {transfer.error || transfer.controlError ? (
        <div className="text-destructive truncate">
          {transfer.error ?? transfer.controlError}
        </div>
      ) : null}
    </div>
  );
};
