import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { gsap } from "gsap";
import {
  CheckCircle2,
  ChevronDown,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
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

function formatTransfer(progress: TransferState): string {
  const total = progress.total ?? 0;
  const speed = progress.speed ? formatSpeed(progress.speed) : null;
  if (!total) {
    return [
      progress.phase,
      progress.transferred ? formatSize(progress.transferred) : null,
      speed,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const percent = Math.min(100, Math.round((progress.transferred / total) * 100));
  return [
    progress.phase,
    `${percent}%`,
    `${formatSize(progress.transferred)} / ${formatSize(total)}`,
    speed,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function TransferPanel() {
  const contentRef = useRef<HTMLDivElement>(null);
  const transfers = useTransfersStore((s) => s.transfers);
  const updateProgressBatch = useTransfersStore((s) => s.updateProgressBatch);
  const markCancelling = useTransfersStore((s) => s.markCancelling);
  const cancelFailed = useTransfersStore((s) => s.cancelFailed);
  const clearFinished = useTransfersStore((s) => s.clearFinished);
  const [open, setOpen] = useState(true);

  const activeTransferCount = transfers.filter((t) => t.status === "running").length;
  const latestTransfer = transfers.find((t) => t.status === "running") ?? transfers[0];

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

  async function cancelTransfer(id: string) {
    markCancelling(id);
    try {
      await ipc.sftpCancelTransfer(id);
    } catch (e) {
      toast.error(String(e));
      cancelFailed(id);
    }
  }

  if (transfers.length === 0) return null;

  return (
    <div className="border-t border-border bg-sidebar">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-sidebar-accent"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="transfer-panel-content"
      >
        {activeTransferCount > 0 ? (
          <RefreshCw className="size-3 animate-spin" />
        ) : (
          <ListChecks className="size-3" />
        )}
        <span className="font-medium text-foreground">传输</span>
        <span className="shrink-0">
          {activeTransferCount > 0 ? `${activeTransferCount} 个进行中` : "空闲"}
        </span>
        {latestTransfer ? (
          <span className="min-w-0 flex-1 truncate">
            {latestTransfer.label} · {formatTransfer(latestTransfer)}
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
      <div
        id="transfer-panel-content"
        ref={contentRef}
        className="overflow-hidden"
      >
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto px-2 pb-2">
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFinished}
              disabled={transfers.length === activeTransferCount}
            >
              清除已完成
            </Button>
          </div>
          {transfers.map((item) => (
            <TransferItem
              key={item.id}
              transfer={item}
              onCancel={cancelTransfer}
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
}: {
  transfer: TransferState;
  onCancel: (id: string) => void;
}) {
  const total = transfer.total ?? 0;
  const progress =
    total > 0 ? Math.min(100, (transfer.transferred / total) * 100) : null;
  const statusIcon =
    transfer.status === "success" ? (
      <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
    ) : transfer.status === "cancelled" ? (
      <XCircle className="size-4 shrink-0 text-muted-foreground" />
    ) : transfer.status === "error" ? (
      <XCircle className="size-4 shrink-0 text-destructive" />
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
          <Button
            variant="ghost"
            size="icon-xs"
            title="取消"
            onClick={() => onCancel(transfer.id)}
            disabled={transfer.cancelling}
          >
            {transfer.cancelling ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <XCircle />
            )}
          </Button>
        ) : null}
      </div>
      <div className="truncate text-muted-foreground tabular-nums">
        {formatTransfer(transfer)}
      </div>
      {progress !== null ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : transfer.status === "running" ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 rounded-full bg-primary/70 duration-700 animate-in slide-in-from-left-full" />
        </div>
      ) : null}
      {transfer.error ? (
        <div className="truncate text-destructive">{transfer.error}</div>
      ) : null}
    </div>
  );
});
