import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { Badge } from "~/components/ui/badge";
import { formatBytes } from "~/features/media-compress/format";
interface CompressEstimateBarProps {
  estimatedBytes?: number | null;
  estimatedMin?: number | null;
  estimatedMax?: number | null;
  ratio?: number | null;
  emptyHint: ReactNode;
  extraBadges?: ReactNode;
  progress?: number;
  showProgress?: boolean;
  progressLabel?: ReactNode;
  primaryAction: ReactNode;
  secondaryAction?: ReactNode;
}
export function CompressEstimateBar({
  estimatedBytes,
  estimatedMin,
  estimatedMax,
  ratio,
  emptyHint,
  extraBadges,
  progress = 0,
  showProgress,
  progressLabel,
  primaryAction,
  secondaryAction,
}: CompressEstimateBarProps) {
  // 区间分支仅在上下界都存在时渲染；单一估值分支由使用处的
  // `estimatedBytes != null` 保护。
  const estimatedMinLabel =
    estimatedMin != null ? formatBytes(estimatedMin) : "";
  const estimatedMaxLabel =
    estimatedMax != null ? formatBytes(estimatedMax) : "";
  const estimatedBytesLabel =
    estimatedBytes != null ? formatBytes(estimatedBytes) : "";
  const ratioPercent = ratio != null ? Math.round(ratio * 100) : 0;
  return (
    <>
      <div className="border-border mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
          {estimatedBytes != null && ratio != null ? (
            <>
              {estimatedMin != null && estimatedMax != null ? (
                <Badge variant="outline">
                  <Trans>
                    预估 {estimatedMinLabel} ~ {estimatedMaxLabel}
                  </Trans>
                </Badge>
              ) : (
                <Badge variant="outline">
                  <Trans>预估 {estimatedBytesLabel}</Trans>
                </Badge>
              )}
              {extraBadges}
              <span>
                <Trans>约原体积的 {ratioPercent}%</Trans>
              </span>
            </>
          ) : (
            <span>{emptyHint}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {secondaryAction}
          {primaryAction}
        </div>
      </div>
      {showProgress ? (
        <div className="mt-2 space-y-1">
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>{progressLabel}</span>
            <span className="tabular-nums">{Math.round(progress)}%</span>
          </div>
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-150"
              style={{
                width: `${Math.min(100, Math.max(0, progress))}%`,
              }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
