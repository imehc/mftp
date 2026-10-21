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
  // 未显式指定时，内容自行滚动默认把底部安全区交给内部滚动容器。
  bottomInset?: "page" | "scroll";
  // 只处理内容区布局；默认间距用 contentDensity，不在这里重写 gap。
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
  bottomInset,
  contentClassName,
}: Props) {
  const inset = bottomInset ?? (scroll === "content" ? "scroll" : "page");
  return (
    <main
      data-bottom-inset={inset}
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
        bottomInset={inset}
        className={contentClassName}
      >
        {children}
      </AppPageContent>
    </main>
  );
}
