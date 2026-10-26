import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { CheckCircle2, LoaderCircle, Pause, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { describeError } from "~/lib/errors";
import { type TransferState, useTransfersStore } from "~/store/transfers";

import { useDockOffsetStore } from "./dock-offset";
import { createTransferActions } from "./transfer-actions";
import { transferIcon } from "./transfer-icon";
import { transferMetrics } from "./transfer-metrics";

/** 成功后停留时长：够读完文件名和大小，又不至于挡视线。 */
const SUCCESS_VISIBLE_MS = 2500;
/** 取消是次要结果，比成功更快让位。 */
const CANCELLED_VISIBLE_MS = 1500;
/** 最小可见时长：小文件秒传时避免闪一下。 */
const MIN_VISIBLE_MS = 600;
/** 折叠阈值：超过就先显示前几条。 */
const COLLAPSED_COUNT = 3;

const RANK: Record<TransferState["status"], number> = {
  running: 0,
  error: 1,
  success: 2,
  cancelled: 3,
};

/** 任务该消失的时刻；`Infinity` 表示需要用户处理，不自动消失。 */
export function hideAt(transfer: TransferState): number {
  if (transfer.status === "running" || transfer.status === "error")
    return Number.POSITIVE_INFINITY;
  const linger =
    transfer.status === "success" ? SUCCESS_VISIBLE_MS : CANCELLED_VISIBLE_MS;
  const finishedAt = transfer.finishedAt ?? transfer.startedAt;
  return Math.max(finishedAt + linger, transfer.startedAt + MIN_VISIBLE_MS);
}

/**
 * 传输坞：右下角常驻的传输反馈。
 *
 * 进度数据本来就由 `useTransfersStore` 持有，此前只在活动页渲染，
 * 用户传完文件无从判断结果。这里把同一份状态放到当前视口，
 * 让"还在传 / 传完了 / 失败了"不用离开当前页面就能确认。
 *
 * 与全局 `Toaster` 同处右下角，通过 `useDockOffsetStore` 上报高度做避让。
 */
export default function TransferDock() {
  const transfers = useTransfersStore((state) => state.transfers);
  const dismiss = useTransfersStore((state) => state.dismiss);
  const setOffset = useDockOffsetStore((state) => state.setOffset);
  const containerRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => performance.now());
  const [expanded, setExpanded] = useState(false);
  const actions = createTransferActions();

  // 只有存在会自动过期的任务时才推进时钟；运行中与失败态不启动定时器。
  const tick = transfers.some((item) => Number.isFinite(hideAt(item)));
  useEffect(() => {
    if (!tick) return;
    const timer = setInterval(() => setNow(performance.now()), 300);
    return () => clearInterval(timer);
  }, [tick]);

  const visible = transfers
    .filter((item) => hideAt(item) > now)
    .sort(
      (a, b) => RANK[a.status] - RANK[b.status] || b.startedAt - a.startedAt,
    );
  const hasVisible = visible.length > 0;

  useEffect(() => {
    const element = containerRef.current;
    if (!hasVisible || !element) {
      setOffset(0);
      return;
    }

    // 上报"坞顶边到视口底的距离 + 间距"：自动包含坞自身的 bottom 与安全区，
    // 全局 toast 据此把自己叠在坞正上方，右边缘与坞对齐。
    const report = () => {
      const rect = element.getBoundingClientRect();
      setOffset(Math.round(window.innerHeight - rect.top + 12));
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => {
      observer.disconnect();
      setOffset(0);
    };
  }, [hasVisible, setOffset]);

  if (!hasVisible) return null;

  const shown = expanded ? visible : visible.slice(0, COLLAPSED_COUNT);
  const hiddenCount = visible.length - shown.length;

  return (
    <div
      ref={containerRef}
      role="status"
      aria-live="polite"
      className="ui-density-adaptive pointer-events-none fixed inset-x-3 bottom-[calc(4rem+var(--safe-bottom,0px))] z-40 flex flex-col md:inset-x-auto md:right-4 md:bottom-[max(0.75rem,var(--safe-bottom,0px))] md:w-80"
    >
      <div className="border-border bg-popover text-popover-foreground pointer-events-auto overflow-hidden rounded-xl border shadow-lg">
        {visible.length > 1 ? <DockSummary items={visible} /> : null}
        <div className="divide-border divide-y">
          {shown.map((item) => (
            <DockItem
              key={item.id}
              transfer={item}
              onCancel={() => void actions.cancelTransfer(item)}
              onRetry={() => void actions.retryTransfer(item)}
              onDismiss={() => dismiss(item.id)}
            />
          ))}
        </div>
        {hiddenCount > 0 ? (
          <CollapseButton onClick={() => setExpanded(true)}>
            <Trans>展开其余 {hiddenCount} 个任务</Trans>
          </CollapseButton>
        ) : expanded && visible.length > COLLAPSED_COUNT ? (
          <CollapseButton onClick={() => setExpanded(false)}>
            <Trans>收起</Trans>
          </CollapseButton>
        ) : null}
      </div>
    </div>
  );
}

function CollapseButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="text-muted-foreground hover:bg-muted/60 hover:text-foreground w-full px-3 py-2 text-xs"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DockSummary({ items }: { items: TransferState[] }) {
  const running = items.filter((item) => item.status === "running").length;
  const failed = items.filter((item) => item.status === "error").length;
  // 总进度只统计运行中的任务；已完成任务计入分母会让百分比倒退。
  const transferred = items.reduce(
    (sum, item) => sum + (item.status === "running" ? item.transferred : 0),
    0,
  );
  const total = items.reduce(
    (sum, item) => sum + (item.status === "running" ? (item.total ?? 0) : 0),
    0,
  );
  const percent = total > 0 ? Math.round((transferred / total) * 100) : null;
  return (
    <div className="bg-muted/50 flex items-center gap-2 px-3 py-1.5 text-xs">
      <span className="text-foreground font-medium">
        {running > 0 ? (
          <Trans>{running} 个传输中</Trans>
        ) : failed > 0 ? (
          <Trans>{failed} 个失败</Trans>
        ) : (
          <Trans>已完成</Trans>
        )}
      </span>
      {percent !== null ? (
        <span className="text-muted-foreground tabular-nums">{percent}%</span>
      ) : null}
    </div>
  );
}

function DockItem({
  transfer,
  onCancel,
  onRetry,
  onDismiss,
}: {
  transfer: TransferState;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLingui();
  const metrics = transferMetrics(transfer);
  const running = transfer.status === "running";
  const succeeded = transfer.status === "success";
  const failed = transfer.status === "error";
  const cancelled = transfer.status === "cancelled";
  const { icon: KindIcon, motion } = transferIcon(
    transfer.kind,
    running && !transfer.paused,
  );
  // 结束态换图标：失败复用操作图标会读成"还在执行"。
  const StatusIcon = failed
    ? XCircle
    : cancelled
      ? XCircle
      : succeeded
        ? CheckCircle2
        : KindIcon;
  const errorText = transfer.controlError ?? transfer.error;
  const metricsEta = metrics.eta;
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      <div className="flex items-center gap-2">
        <StatusIcon
          aria-hidden
          className={cn(
            "size-4 shrink-0",
            succeeded && "animate-in zoom-in-50 text-primary duration-200",
            failed && "text-destructive",
            (cancelled || running) && "text-muted-foreground",
            running &&
              motion === "bob" &&
              "motion-safe:animate-[transfer-icon-bob_1.2s_ease-in-out_infinite]",
            running && motion === "spin" && "animate-spin",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {transfer.label}
        </span>
        {transfer.paused ? (
          <Pause
            aria-hidden
            className="text-muted-foreground size-3.5 shrink-0"
          />
        ) : null}
        {metrics.percent !== null ? (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {metrics.percent}%
          </span>
        ) : null}
        {running && transfer.cancellable !== false ? (
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            className="shrink-0"
            title={t`取消`}
            aria-label={t`取消`}
            onClick={onCancel}
            disabled={transfer.cancelling || transfer.controlPending}
          >
            {transfer.cancelling ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <X />
            )}
          </Button>
        ) : failed ? (
          <div className="flex shrink-0 items-center gap-0.5">
            {transfer.retry ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={onRetry}
                disabled={transfer.retrying}
              >
                {transfer.retrying ? (
                  <LoaderCircle
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : null}
                <Trans>重试</Trans>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              density="adaptive"
              className="shrink-0"
              title={t`关闭`}
              aria-label={t`关闭`}
              onClick={onDismiss}
            >
              <X />
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            className="shrink-0"
            title={t`关闭`}
            aria-label={t`关闭`}
            onClick={onDismiss}
          >
            <X />
          </Button>
        )}
      </div>
      <DockProgress transfer={transfer} percent={metrics.percent} />
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs tabular-nums">
        <span
          className={cn(
            succeeded && "text-primary",
            failed && "text-destructive",
          )}
        >
          {transfer.phase}
        </span>
        {metrics.size ? <span>{metrics.size}</span> : null}
        {metrics.speed ? <span>{metrics.speed}</span> : null}
        {metrics.eta ? (
          <span>
            <Trans>剩余 {metricsEta}</Trans>
          </span>
        ) : null}
      </div>
      {errorText ? (
        <p role="alert" className="text-destructive text-xs wrap-break-word">
          {describeError(errorText, t)}
        </p>
      ) : null}
    </div>
  );
}

function DockProgress({
  transfer,
  percent,
}: {
  transfer: TransferState;
  percent: number | null;
}) {
  const { t } = useLingui();
  const running = transfer.status === "running";
  return (
    <div
      role="progressbar"
      aria-label={t`传输进度`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      className="bg-muted relative h-1.5 w-full overflow-hidden rounded-full"
    >
      <div
        className={cn(
          "bg-primary relative h-full rounded-full transition-[width] duration-200 ease-out",
          running && !transfer.paused && "transfer-progress-stripes",
          percent === null && running && "w-full opacity-40",
        )}
        style={percent !== null ? { width: `${percent}%` } : undefined}
      />
    </div>
  );
}
