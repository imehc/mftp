import { cn } from "cn";
import type { ReactNode } from "react";

import AppPageContent from "~/components/AppPageContent";
import { ToolPageHeader } from "~/components/ToolPageHeader";

interface Props {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  width?: "standard" | "full";
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
  width = "standard",
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
      <AppPageContent
        width={width}
        scroll={scroll}
        density={contentDensity}
        bottomInset={bottomInset}
        className={contentClassName}
      >
        {children}
      </AppPageContent>
    </main>
  );
}
