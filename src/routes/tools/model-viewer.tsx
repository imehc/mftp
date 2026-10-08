import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import ModelViewerPage from "~/features/model-viewer/ModelViewerPage";
import { useSettingsStore } from "~/store/settings";

export const Route = createFileRoute("/tools/model-viewer")({
  component: ModelViewerRoute,
});

function ModelViewerRoute() {
  const setLastTool = useSettingsStore((state) => state.setLastTool);
  useEffect(() => {
    setLastTool("model-viewer");
  }, [setLastTool]);
  return <ModelViewerPage />;
}
