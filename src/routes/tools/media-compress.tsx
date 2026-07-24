import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import MediaCompressTool from "~/features/media-compress/MediaCompressTool";
import { resolveCompressMode } from "~/features/media-compress/modes";
import { useSettingsStore } from "~/store/settings";

export const Route = createFileRoute("/tools/media-compress")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: resolveCompressMode(search.mode),
  }),
  component: MediaCompressRoute,
});

function MediaCompressRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);
  const { mode } = Route.useSearch();

  useEffect(() => {
    setLastTool("media-compress");
  }, [setLastTool]);

  return <MediaCompressTool mode={mode} />;
}
