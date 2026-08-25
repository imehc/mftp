import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import PoemDetailPage from "~/features/poetry/PoemDetailPage";
import { desktopOnlyGuard } from "~/lib/platform";
import { useSettingsStore } from "~/store/settings";

/**
 * Standalone detail route: the desktop UI shows details in the right pane of
 * `/library`, but direct links (e.g. after a collection was re-synced) must
 * still render a full page.
 */
function LibraryPoemRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);
  const uid = Route.useParams().id;

  useEffect(() => {
    setLastTool("library");
  }, [setLastTool]);

  return <PoemDetailPage uid={uid} />;
}

export const Route = createFileRoute("/library/$id")({
  beforeLoad: desktopOnlyGuard,
  component: LibraryPoemRoute,
});
