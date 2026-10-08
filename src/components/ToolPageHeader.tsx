import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { Home } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { TOUCH_TARGET_CHILDREN_CLASS, TOUCH_TARGET_CLASS } from "~/lib/touch";

interface ToolPageHeaderProps {
  title: ReactNode;
  trailing?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
  showHome?: boolean;
  status?: ReactNode;
}

export function ToolPageHeader({
  title,
  trailing,
  leading,
  children,
  showHome = true,
  status,
}: ToolPageHeaderProps) {
  const { t } = useLingui();
  return (
    <header
      className={cn(
        "border-border flex min-h-11 shrink-0 items-center justify-between gap-2 border-b px-2 md:min-h-9 pointer-coarse:min-h-11",
        !showHome && "min-h-12 md:min-h-12 pointer-coarse:min-h-12",
        TOUCH_TARGET_CHILDREN_CLASS,
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {leading}
        {showHome ? (
          <Button
            variant="ghost"
            size="xs"
            className={cn(TOUCH_TARGET_CLASS, "shrink-0")}
            asChild
          >
            <Link to="/" aria-label={t`返回首页`} title={t`返回首页`}>
              <Home data-icon="inline-start" />
              {/* 小屏只留图标，把宽度让给页面标题与主要操作。 */}
              <span className="hidden md:inline">
                <Trans>首页</Trans>
              </span>
            </Link>
          </Button>
        ) : null}
        {showHome ? (
          <div className="bg-border hidden h-4 w-px md:block" />
        ) : null}
        {/* 标题在所有宽度都要可识别：窄屏只截断，不隐藏。 */}
        <div
          className={cn(
            "min-w-0 truncate font-medium",
            showHome ? "text-muted-foreground text-xs" : "text-sm",
          )}
        >
          {title}
        </div>
        {children}
      </div>
      {trailing || status ? (
        <div className="flex shrink-0 items-center gap-1">
          {trailing}
          {status}
        </div>
      ) : null}
    </header>
  );
}
