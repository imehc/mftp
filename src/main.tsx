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
