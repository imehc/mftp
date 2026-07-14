import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
import {
  type TransferState,
  useTransfersStore,
} from "~/store/transfers";
import { Button } from "~/components/ui/button";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function formatSpeed(bytesPerSecond: number): string {
  return `${formatSize(bytesPerSecond)}/s`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  const rounded = Math.ceil(seconds);
  if (rounded < 60) return `${rounded} 秒`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes} 分 ${remainingSeconds} 秒`
      : `${minutes} 分`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`;
}

function transferMetrics(progress: TransferState) {
  const total = progress.total ?? 0;
  const percent =
    total > 0 ? Math.min(100, Math.round((progress.transferred / total) * 100)) : null;
  const speed = progress.speed && progress.speed > 0 ? progress.speed : null;
  const eta =
    progress.status === "running" && !progress.paused && total > 0 && speed
      ? formatDuration((total - progress.transferred) / speed)
      : null;

  return {
    percent,
    size:
      total > 0
        ? `${formatSize(progress.transferred)} / ${formatSize(total)}`
        : progress.transferred
          ? formatSize(progress.transferred)
          : null,
    speed: speed ? formatSpeed(speed) : null,
    eta,
  };
}

export default function TransferPanel() {
  const contentRef = useRef<HTMLDivElement>(null);
  const transfers = useTransfersStore((s) => s.transfers);
  const updateProgressBatch = useTransfersStore((s) => s.updateProgressBatch);
  const markCancelling = useTransfersStore((s) => s.markCancelling);
  const cancelFailed = useTransfersStore((s) => s.cancelFailed);
  const setPaused = useTransfersStore((s) => s.setPaused);
  const setControlPending = useTransfersStore((s) => s.setControlPending);
  const setControlError = useTransfersStore((s) => s.setControlError);
  const setRetrying = useTransfersStore((s) => s.setRetrying);
  const clearFinished = useTransfersStore((s) => s.clearFinished);
  const [open, setOpen] = useState(true);

  const activeTransferCount = transfers.filter((t) => t.status === "running").length;
  const pausedTransferCount = transfers.filter(
    (t) => t.status === "running" && t.paused,
  ).length;
  const transferringCount = activeTransferCount - pausedTransferCount;
  const finishedTransferCount = transfers.length - activeTransferCount;
  const latestTransfer = transfers.find((t) => t.status === "running") ?? transfers[0];
  const latestMetrics = latestTransfer ? transferMetrics(latestTransfer) : null;
  const transferStatusLabel =
    activeTransferCount === 0
      ? "空闲"
      : transferringCount === 0
        ? `${pausedTransferCount} 个已暂停`
        : pausedTransferCount > 0
          ? `${transferringCount} 进行中 · ${pausedTransferCount} 已暂停`
          : `${transferringCount} 个进行中`;

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

    void listen<TransferProgress>("sftp-transfer-progress", (event) => {
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

  useEffect(() => {
    if (activeTransferCount > 0) setOpen(true);
  }, [activeTransferCount]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    gsap.killTweensOf(content);
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reduceMotion) {
      gsap.set(content, {
        display: open ? "block" : "none",
        clearProps: "height,opacity,transform",
      });
      return;
    }

    if (open) {
      gsap.set(content, { display: "block", height: "auto" });
      const height = content.offsetHeight;
      gsap.fromTo(
        content,
        { height: 0, opacity: 0, y: -6 },
        {
          height,
          opacity: 1,
          y: 0,
          duration: 0.34,
          ease: "power3.out",
          onComplete: () => gsap.set(content, { height: "auto" }),
        },
      );
    } else {
      gsap.to(content, {
        height: 0,
        opacity: 0,
        y: -4,
        duration: 0.22,
        ease: "power2.inOut",
        onComplete: () => gsap.set(content, { display: "none" }),
      });
    }

    return () => gsap.killTweensOf(content);
  }, [open]);

  const cancelTransfer = useCallback(
    async (id: string) => {
      setControlError(id);
      markCancelling(id);
      try {
        await ipc.sftpCancelTransfer(id);
      } catch (error) {
        cancelFailed(id);
        setControlError(id, String(error));
      }
    },
    [cancelFailed, markCancelling, setControlError],
  );

  const togglePause = useCallback(
    async (transfer: TransferState) => {
      if (transfer.controlPending || transfer.cancelling) return;
      setControlError(transfer.id);
      setControlPending(transfer.id, true);
      try {
        if (transfer.paused) {
          await ipc.sftpResumeTransfer(transfer.id);
          setPaused(transfer.id, false);
        } else {
          await ipc.sftpPauseTransfer(transfer.id);
          setPaused(transfer.id, true);
        }
      } catch (error) {
        setControlError(transfer.id, String(error));
      } finally {
        setControlPending(transfer.id, false);
      }
    },
    [setControlError, setControlPending, setPaused],
  );

  const retryTransfer = useCallback(
    async (transfer: TransferState) => {
      if (!transfer.retry || transfer.retrying) return;
      setRetrying(transfer.id, true);
      try {
        await transfer.retry();
      } catch (error) {
        setControlError(transfer.id, String(error));
        setRetrying(transfer.id, false);
      }
    },
    [setControlError, setRetrying],
  );

  if (transfers.length === 0) return null;

  return (
    <div className="border-t border-border bg-sidebar">
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-sidebar-accent"
          onClick={() => setOpen((value) => !value)}
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
          <span className="font-medium text-foreground">传输</span>
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
            title={`清除 ${finishedTransferCount} 个已完成任务`}
            aria-label={`清除 ${finishedTransferCount} 个已完成任务`}
          >
            <Trash2 data-icon="inline-start" />
            清除 {finishedTransferCount}
          </Button>
        ) : null}
      </div>
      <div
        id="transfer-panel-content"
        ref={contentRef}
        className="overflow-hidden"
      >
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto px-2 pb-2 pt-1">
          {transfers.map((item) => (
            <TransferItem
              key={item.id}
              transfer={item}
              onCancel={cancelTransfer}
              onTogglePause={togglePause}
              onRetry={retryTransfer}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const TransferItem = memo(function TransferItem({
  transfer,
  onCancel,
  onTogglePause,
  onRetry,
}: {
  transfer: TransferState;
  onCancel: (id: string) => void;
  onTogglePause: (transfer: TransferState) => void;
  onRetry: (transfer: TransferState) => void;
}) {
  const total = transfer.total ?? 0;
  const progress =
    total > 0 ? Math.min(100, (transfer.transferred / total) * 100) : null;
  const metrics = transferMetrics(transfer);
  const statusIcon =
    transfer.status === "success" ? (
      <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
    ) : transfer.status === "cancelled" ? (
      <XCircle className="size-4 shrink-0 text-muted-foreground" />
    ) : transfer.status === "error" ? (
      <XCircle className="size-4 shrink-0 text-destructive" />
    ) : transfer.paused ? (
      <Pause className="size-4 shrink-0 text-muted-foreground" />
    ) : (
      <RefreshCw className="size-4 shrink-0 animate-spin text-muted-foreground" />
    );

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-background px-2 py-2 text-xs">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        {statusIcon}
        <span className="min-w-0 truncate font-medium text-foreground">
          {transfer.label}
        </span>
        {transfer.status === "running" && transfer.cancellable !== false ? (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              title={transfer.paused ? "继续" : "暂停"}
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
              title="取消"
              onClick={() => onCancel(transfer.id)}
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
            title="重试"
            onClick={() => onRetry(transfer)}
            disabled={transfer.retrying}
          >
            {transfer.retrying ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            重试
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground tabular-nums">
        <span className="font-medium text-foreground">{transfer.phase}</span>
        {metrics.percent !== null ? <span>{metrics.percent}%</span> : null}
        {metrics.size ? <span>{metrics.size}</span> : null}
        {metrics.speed ? <span>{metrics.speed}</span> : null}
        {metrics.eta ? <span>剩余 {metrics.eta}</span> : null}
      </div>
      {progress !== null ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : transfer.status === "running" && !transfer.paused ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 rounded-full bg-primary/70 duration-700 animate-in slide-in-from-left-full" />
        </div>
      ) : null}
      {transfer.error || transfer.controlError ? (
        <div className="truncate text-destructive">
          {transfer.error ?? transfer.controlError}
        </div>
      ) : null}
    </div>
  );
});
