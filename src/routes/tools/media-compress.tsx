import { createFileRoute } from "@tanstack/react-router";

import MediaCompressTool from "~/features/media-compress/MediaCompressTool";
import { resolveCompressMode } from "~/features/media-compress/modes";
import { useRememberTool } from "~/features/navigation/use-remember-tool";

export const Route = createFileRoute("/tools/media-compress")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: resolveCompressMode(search.mode),
  }),
  component: MediaCompressRoute,
});

function MediaCompressRoute() {
  useRememberTool("media-compress");
  const { mode } = Route.useSearch();

  return <MediaCompressTool mode={mode} />;
}
