import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { Button } from "~/components/ui/button";
import { TOUCH_TARGET_CHILDREN_CLASS } from "~/lib/touch";
import { cn } from "cn";

interface Props {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  maxWidth?: string;
  scroll?: "page" | "content";
  adaptiveDensity?: boolean;
  // 内容自行滚动时，滚动容器须使用 app-scroll-safe-end 承接底部安全区。
  bottomInset?: "page" | "scroll";
  contentClassName?: string;
}

export default function AppPageLayout({
  title,
  description,
  actions,
  children,
  maxWidth = "max-w-5xl",
  scroll = "page",
  adaptiveDensity = false,
  bottomInset = "page",
  contentClassName,
}: Props) {
  const { t } = useLingui();
  return (
    <main
      data-bottom-inset={bottomInset}
      className={cn(
        "bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden",
        adaptiveDensity && "ui-density-adaptive",
      )}
    >
      <header
        className={cn(
          "border-border flex min-h-11 shrink-0 items-center justify-between gap-3 border-b px-3 md:px-4 md:py-2 pointer-coarse:py-0",
          TOUCH_TARGET_CHILDREN_CLASS,
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to="/" aria-label={t`返回首页`} title={t`返回首页`}>
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            {description ? (
              <p className="text-muted-foreground truncate text-xs">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      <div
        className={cn(
          "mx-auto min-h-0 w-full flex-1",
          adaptiveDensity
            ? "px-3 pt-3 md:px-4 md:pt-4"
            : "px-2.5 pt-2.5 md:px-3 md:pt-3",
          scroll === "page" ? "overflow-auto" : "flex flex-col overflow-hidden",
          bottomInset === "page"
            ? adaptiveDensity
              ? "pb-3 md:pb-4"
              : "pb-2.5 md:pb-3"
            : scroll === "page" && "app-scroll-safe-end",
          maxWidth,
          contentClassName,
        )}
      >
        {children}
      </div>
    </main>
  );
}
