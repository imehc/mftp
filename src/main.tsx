import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";
import { AppI18nProvider } from "~/i18n/I18nProvider";
import { checkForUpdateOnLaunch } from "~/lib/updater";
import { applyStoredColorTheme } from "~/lib/color-theme";
import "./App.css";

applyStoredColorTheme();

// Production builds: suppress the WebView's default context menu
// (Back / Reload etc. would break the SPA illusion). Keep it on editable
// elements and text selections for native copy/paste, and keep it
// entirely in dev for debugging.
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
          <RouterProvider router={router} />
        </TooltipProvider>
        <Toaster position="bottom-right" />
      </AppI18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

void checkForUpdateOnLaunch();
