import "./App.css";

import { RouterProvider } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";

import { AppRuntime } from "~/app/AppRuntime";
import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";
import { AppI18nProvider } from "~/i18n/I18nProvider";
import { applyStoredColorTheme } from "~/lib/color-theme";
import { checkForUpdateOnLaunch } from "~/lib/updater";

import { router } from "./router";

applyStoredColorTheme();

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
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AppI18nProvider>
        <TooltipProvider>
          <AppRuntime />
          <RouterProvider router={router} />
        </TooltipProvider>
        <Toaster position="bottom-right" />
      </AppI18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

void checkForUpdateOnLaunch();
