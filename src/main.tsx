import "./App.css";

import { RouterProvider } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";

import { AppRuntime } from "~/app/AppRuntime";
import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";
import ResetBoundary from "~/features/about/ResetBoundary";
import UpdaterDialog from "~/features/updater/UpdaterDialog";
import { AppI18nProvider } from "~/i18n/I18nProvider";
import { applyStoredColorTheme } from "~/lib/color-theme";
import { applyStoredDisplaySize } from "~/lib/display-size";
import { applyStoredAppearance } from "~/lib/initial-appearance";
import { checkForUpdateOnLaunch } from "~/lib/updater";

import { router } from "./router";

applyStoredColorTheme();
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
            <AppRuntime />
            <RouterProvider router={router} />
            <UpdaterDialog />
          </ResetBoundary>
        </TooltipProvider>
        <Toaster position="bottom-right" />
      </AppI18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

void checkForUpdateOnLaunch();
