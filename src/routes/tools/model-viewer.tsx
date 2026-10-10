import { createFileRoute } from "@tanstack/react-router";

import ModelViewerPage from "~/features/model-viewer/ModelViewerPage";
import { useRememberTool } from "~/features/navigation/use-remember-tool";

export const Route = createFileRoute("/tools/model-viewer")({
  component: ModelViewerRoute,
});

function ModelViewerRoute() {
  useRememberTool("model-viewer");
  return <ModelViewerPage />;
}
