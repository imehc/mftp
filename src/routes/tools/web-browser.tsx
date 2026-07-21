import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import WebBrowserTool from "~/features/web-browser/WebBrowserTool";
import { useSettingsStore } from "~/store/settings";

function WebBrowserRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);

  useEffect(() => {
    setLastTool("web-browser");
  }, [setLastTool]);

  return <WebBrowserTool />;
}

export const Route = createFileRoute("/tools/web-browser")({
  component: WebBrowserRoute,
});
