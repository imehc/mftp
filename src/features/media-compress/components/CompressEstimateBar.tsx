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
  return (
    <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {estimatedBytes != null && ratio != null ? (
            <>
              {estimatedMin != null && estimatedMax != null ? (
                <Badge variant="outline">
                  <Trans>预估 {formatBytes(estimatedMin)} ~ {formatBytes(estimatedMax)}</Trans>
                </Badge>
              ) : (
                <Badge variant="outline">
                  <Trans>预估 {formatBytes(estimatedBytes)}</Trans>
                </Badge>
              )}
              {extraBadges}
              <span>
                <Trans>约原体积的 {Math.round(ratio * 100)}%</Trans>
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
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{progressLabel}</span>
            <span className="tabular-nums">{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-150"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
