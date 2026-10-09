import { cn } from "cn";
import type { ReactNode } from "react";

import { ToolPageHeader } from "~/components/ToolPageHeader";

interface Props {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  maxWidth?: string;
  scroll?: "page" | "content";
  adaptiveDensity?: boolean;
  contentDensity?: "standard" | "compact";
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
  adaptiveDensity = true,
  contentDensity = "standard",
  bottomInset = "page",
  contentClassName,
}: Props) {
  return (
    <main
      data-bottom-inset={bottomInset}
      className={cn(
        "bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden",
        adaptiveDensity && "ui-density-adaptive",
      )}
    >
      <ToolPageHeader
        title={title}
        description={description}
        trailing={actions}
      />
      <div
        className={cn(
          "app-page-gutter mx-auto flex min-h-0 w-full flex-1 flex-col",
          contentDensity === "compact" ? "gap-3" : "gap-4",
          scroll === "page" ? "overflow-auto" : "flex flex-col overflow-hidden",
          bottomInset === "page"
            ? "app-page-bottom"
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
