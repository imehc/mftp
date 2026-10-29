import "./App.css";

import { RouterProvider } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";

import { AppRuntime } from "~/app/AppRuntime";
import QueryProvider from "~/app/QueryProvider";
import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";
import ResetBoundary from "~/features/about/ResetBoundary";
import { useDockOffsetStore } from "~/features/transfers/dock-offset";
import TransferDock from "~/features/transfers/TransferDock";
import { UpdaterDialog } from "~/features/updater/integration";
import { AppI18nProvider } from "~/i18n/I18nProvider";
import { applyStoredThemeAndFonts } from "~/lib/color-theme";
import { applyStoredDisplaySize } from "~/lib/display-size";
import { applyStoredAppearance } from "~/lib/initial-appearance";
import { useMediaQuery } from "~/lib/use-media-query";

import { router } from "./router";

applyStoredThemeAndFonts();
applyStoredDisplaySize();
applyStoredAppearance();

// 生产构建：屏蔽 WebView 默认的右键菜单（Back / Reload 等会破坏 SPA 的
// 单页体验）。但在可编辑元素和文本选中处保留，以便使用原生复制 /
// 粘贴；开发环境则完全保留，方便调试。
if (import.meta.env.PROD) {
  window.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable]")) return;
    if (window.getSelection()?.toString()) return;
    event.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* 纯客户端首屏已在 render 前恢复主题；禁用库为 SSR 输出的内联脚本。 */}
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      scriptProps={{ type: "application/x-next-themes" }}
    >
      <AppI18nProvider>
        <TooltipProvider>
          <ResetBoundary>
            <QueryProvider>
              <AppRuntime />
              <RouterProvider router={router} />
              <UpdaterDialog />
              <TransferDock />
            </QueryProvider>
          </ResetBoundary>
        </TooltipProvider>
        <AppToaster />
      </AppI18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

/**
 * 右下角浮层只有一个栈：传输坞占最底层，toast 按坞上报的高度往上让位，
 * 宽度、圆角和右边距与坞一致，避免两个卡片叠在一起时边缘错位。
 */
function AppToaster() {
  const offset = useDockOffsetStore((state) => state.offset);
  const wide = useMediaQuery("(min-width: 48rem)");
  const bottom = offset > 0 ? offset : 16;
  return (
    <Toaster
      position="bottom-right"
      offset={{ right: 16, bottom }}
      mobileOffset={{ left: 12, right: 12, bottom }}
      style={
        {
          "--border-radius": "0.75rem",
          // 与传输坞同宽；移动端交给 sonner 自适应，坞本身是满宽。
          ...(wide ? { "--width": "20rem" } : {}),
        } as React.CSSProperties
      }
    />
  );
}
