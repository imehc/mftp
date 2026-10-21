import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { Activity } from "lucide-react";

import { Button } from "~/components/ui/button";

import type { ActivitySummary } from "./activity-summary";
import { ACTIVITY_PANEL_ID, useActivityPanel } from "./ActivityProvider";
import { useActivitySummary } from "./use-activity-summary";

/** 桌面导航底部与移动标题栏共用同一份聚合状态，仅容器样式不同。 */
export default function ActivityEntry({
  variant,
}: {
  variant: "rail" | "header";
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { panelOpen, openPanel } = useActivityPanel();
  const summary = useActivitySummary();
  const { failed, running } = summary;
  const label =
    failed > 0 && running > 0
      ? t`活动，${failed} 个任务失败，${running} 个任务进行中`
      : failed > 0
        ? t`活动，${failed} 个任务失败`
        : running > 0
          ? t`活动，${running} 个任务进行中`
          : summary.updatePending
            ? t`活动，有可用更新`
            : summary.logsActive
              ? t`活动，有外部服务调用`
              : t`活动`;
  if (variant === "header") {
    return (
      <Button
        data-activity-entry="header"
        variant="ghost"
        size="icon-sm"
        className="relative shrink-0 md:hidden"
        aria-label={label}
        title={label}
        onClick={() => void navigate({ to: "/activity" })}
      >
        <span className="relative">
          <Activity aria-hidden />
          <ActivityBadge summary={summary} />
        </span>
      </Button>
    );
  }
  return (
    <Button
      data-activity-entry="rail"
      variant={panelOpen ? "secondary" : "ghost"}
      className="relative h-14.5 w-full flex-col gap-1 px-1 text-xs"
      aria-label={label}
      title={label}
      aria-expanded={panelOpen}
      aria-controls={panelOpen ? ACTIVITY_PANEL_ID : undefined}
      onClick={() => {
        // 再次点击入口只把焦点移回已打开的面板，不把它切到关闭状态。
        if (panelOpen) document.getElementById(ACTIVITY_PANEL_ID)?.focus();
        else openPanel();
      }}
    >
      <span className="relative">
        <Activity aria-hidden />
        <ActivityBadge summary={summary} />
      </span>
      <span className="max-w-full truncate">
        <Trans>活动</Trans>
      </span>
    </Button>
  );
}

function ActivityBadge({ summary }: { summary: ActivitySummary }) {
  if (summary.tone === "attention") {
    return (
      <span
        aria-hidden
        className="bg-primary ring-background absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2"
      />
    );
  }
  if (summary.tone === "logs") {
    return (
      <span
        aria-hidden
        className="bg-muted-foreground/60 ring-background absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-2"
      />
    );
  }
  if (summary.tone !== "error" && summary.tone !== "running") return null;
  const count = summary.count ?? 0;
  return (
    <span
      aria-hidden
      className={cn(
        "ring-background absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium ring-2",
        summary.tone === "error"
          ? "bg-destructive text-white"
          : "bg-primary text-primary-foreground",
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
