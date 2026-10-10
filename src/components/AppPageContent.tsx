import { cn } from "cn";
import type { ReactNode } from "react";

/** 限宽包含边距；滚动条始终属于全宽外层，避免长短页面左右跳动。 */
export default function AppPageContent({
  children,
  width = "standard",
  scroll = "page",
  density = "standard",
  bottomInset = "page",
  className,
}: {
  children: ReactNode;
  width?: "standard" | "full";
  scroll?: "page" | "content";
  density?: "standard" | "compact";
  bottomInset?: "page" | "scroll";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-h-0 min-w-0 flex-1",
        scroll === "page" ? "overflow-auto" : "flex overflow-hidden",
      )}
    >
      <div
        className={cn(
          "app-page-gutter mx-auto flex w-full min-w-0 flex-col",
          {
            "app-page-width": width === "standard",
            "app-page-bottom": bottomInset === "page",
            "app-scroll-safe-end": bottomInset !== "page" && scroll === "page",
          },
          scroll === "content"
            ? "min-h-0 flex-1 overflow-hidden"
            : "min-h-full",
          density === "standard" ? "gap-4" : "gap-3",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
