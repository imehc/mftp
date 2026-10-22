import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "cn";
import {
  Activity,
  ArrowDownUp,
  CircleAlert,
  Download,
  Logs,
  RefreshCw,
} from "lucide-react";

import { Button } from "~/components/ui/button";

import type { ActivitySummary } from "./activity-summary";
import { useActivityViewStore } from "./activity-view-store";
import { useActivitySummary } from "./use-activity-summary";

/** 桌面导航底部与移动标题栏共用同一份聚合状态，仅容器样式不同。 */
export default function ActivityEntry({
  variant,
}: {
  variant: "rail" | "header";
}) {
  const { t } = useLingui();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const tab = useActivityViewStore((state) => state.tab);
  const active = pathname.replace(/\/+$/, "") === "/activity";
  const summary = useActivitySummary();
  const icons = {
    idle: Activity,
    mixed: Activity,
    transfer: ArrowDownUp,
    sync: RefreshCw,
    update: Download,
    logs: Logs,
  };
  const Icon = icons[summary.kind];
  const { failed, running } = summary;
  const label =
    failed > 0 && running > 0
      ? t`活动，${failed} 个任务失败，${running} 个任务进行中`
      : failed > 0
        ? t`活动，${failed} 个任务失败`
        : running > 0
          ? t`活动，${running} 个任务进行中`
          : summary.tone === "error"
            ? t({
                comment: "活动入口：当前内存日志包含失败或中断的外部操作",
                message: "活动，有操作失败",
              })
            : summary.tone === "running"
              ? t({
                  comment: "活动入口：当前有外部交互仍在执行",
                  message: "活动，有操作进行中",
                })
              : summary.updatePending
                ? t`活动，有可用更新`
                : t`活动`;
  const accessibleLabel =
    failed === 0 && summary.tone === "error"
      ? t({
          comment: "活动入口：当前内存日志包含失败或中断的外部操作",
          message: "活动，有操作失败",
        })
      : label;
  if (variant === "header" && active) return null;
  return (
    <Button
      asChild
      variant={active ? "secondary" : "ghost"}
      size={variant === "header" ? "icon-sm" : "default"}
      className={
        variant === "header"
          ? "relative shrink-0 md:hidden"
          : "relative h-14.5 w-full flex-col gap-1 px-1 text-xs"
      }
    >
      <Link
        to="/activity"
        search={{ tab: summary.destination ?? tab }}
        data-activity-entry={variant}
        data-activity-kind={summary.kind}
        aria-label={accessibleLabel}
        title={accessibleLabel}
        aria-current={active ? "page" : undefined}
      >
        <span className="relative">
          <Icon aria-hidden />
          <ActivityBadge summary={summary} />
        </span>
        {variant === "rail" ? (
          <span className="max-w-full truncate">
            <Trans>活动</Trans>
          </span>
        ) : null}
      </Link>
    </Button>
  );
}

function ActivityBadge({ summary }: { summary: ActivitySummary }) {
  if (summary.tone === "error") {
    return (
      <CircleAlert
        aria-hidden
        className="bg-background text-destructive absolute -top-1 -right-1 size-3 rounded-full"
      />
    );
  }
  if (summary.tone === "running" || summary.tone === "attention") {
    return (
      <span
        aria-hidden
        className={cn(
          "ring-background absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2",
          summary.tone === "running" ? "bg-primary" : "bg-warning",
        )}
      />
    );
  }
  return null;
}
