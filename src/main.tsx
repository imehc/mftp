import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";
import { checkForUpdateOnLaunch } from "~/lib/updater";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
    <Toaster position="bottom-right" />
  </React.StrictMode>,
);

void checkForUpdateOnLaunch();
