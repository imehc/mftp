import { Trans, useLingui } from "@lingui/react/macro";
import {
  CheckCircle2,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "~/components/ui/button";
import { describeError } from "~/lib/errors";
import type { TransferState } from "~/store/transfers";
import { transferMetrics } from "./transfer-metrics";
export default function TransferItem({
  transfer,
  onCancel,
  onTogglePause,
  onRetry,
  spacious = false,
}: {
  transfer: TransferState;
  spacious?: boolean;
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
    <div
      className={cn(
        "border-border bg-background flex flex-col gap-1 rounded-md border px-2 py-2 text-xs",
        spacious && "gap-2 rounded-xl p-3 text-sm",
      )}
    >
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
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs tabular-nums">
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
        <div className="text-destructive break-words">
          {describeError(transfer.error ?? transfer.controlError)}
        </div>
      ) : null}
    </div>
  );
}
