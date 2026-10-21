import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowLeft, Home } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import ActivityEntry from "~/features/activity/ActivityEntry";
import { TOUCH_TARGET_CHILDREN_CLASS, TOUCH_TARGET_CLASS } from "~/lib/touch";

interface ToolPageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  variant?: "standard" | "compact";
  trailing?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
  showHome?: boolean;
  showActivity?: boolean;
  status?: ReactNode;
}

export function ToolPageHeader({
  title,
  description,
  variant = "standard",
  trailing,
  leading,
  children,
  showHome = true,
  showActivity = true,
  status,
}: ToolPageHeaderProps) {
  const { t } = useLingui();
  return (
    <header
      className={cn(
        "border-border flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b",
        variant === "standard"
          ? "min-h-12 px-3 py-1 md:px-4"
          : "min-h-11 px-2 md:min-h-9 pointer-coarse:min-h-11",
        TOUCH_TARGET_CHILDREN_CLASS,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {leading}
        {showHome ? (
          <Button
            variant="ghost"
            size={variant === "compact" ? "xs" : "icon-sm"}
            className={cn(TOUCH_TARGET_CLASS, "shrink-0")}
            asChild
          >
            <Link to="/" aria-label={t`返回首页`} title={t`返回首页`}>
              {variant === "compact" ? (
                <Home data-icon="inline-start" />
              ) : (
                <ArrowLeft />
              )}
              {/* 小屏只留图标，把宽度让给页面标题与主要操作。 */}
              <span
                className={
                  variant === "compact" ? "hidden md:inline" : "sr-only"
                }
              >
                <Trans>首页</Trans>
              </span>
            </Link>
          </Button>
        ) : null}
        {showHome && variant === "compact" ? (
          <div className="bg-border hidden h-4 w-px md:block" />
        ) : null}
        {/* 标题在所有宽度都要可识别：窄屏只截断，不隐藏。 */}
        <div className="min-w-0">
          <h1
            className={cn(
              "truncate font-semibold",
              variant === "compact"
                ? "text-muted-foreground text-xs"
                : "text-sm",
            )}
          >
            {title}
          </h1>
          {description ? (
            <p className="text-muted-foreground truncate text-xs">
              {description}
            </p>
          ) : null}
        </div>
        {children}
      </div>
      {trailing || status || showActivity ? (
        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
          {trailing}
          {status}
          {showActivity ? <ActivityEntry variant="header" /> : null}
        </div>
      ) : null}
    </header>
  );
}
