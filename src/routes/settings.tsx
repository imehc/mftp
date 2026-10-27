import { createFileRoute } from "@tanstack/react-router";

import {
  type PoetryReadingView,
  resolvePoetryReadingView,
} from "~/features/poetry/reading-view";
import SettingsPage from "~/features/settings/SettingsPage";
import { desktopOnlyGuard } from "~/lib/platform";

interface SettingsSearch {
  panel?: "ai" | "data" | "features" | "mcp";
  returnUid?: string;
  returnQ?: string;
  returnView?: PoetryReadingView;
  returnPage?: "library" | "detail";
}

function SettingsRoute() {
  return <SettingsPage returnContext={Route.useSearch()} />;
}

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
    panel:
      search.panel === "ai" ||
      search.panel === "data" ||
      search.panel === "mcp" ||
      search.panel === "features"
        ? search.panel
        : undefined,
    returnUid:
      typeof search.returnUid === "string" ? search.returnUid : undefined,
    returnQ: typeof search.returnQ === "string" ? search.returnQ : undefined,
    returnPage: search.returnPage === "library" ? "library" : undefined,
    returnView: resolvePoetryReadingView(search.returnView, search.returnMode),
  }),
  beforeLoad: ({ search }) => {
    if (search.panel === "mcp") desktopOnlyGuard();
  },
  component: SettingsRoute,
});
