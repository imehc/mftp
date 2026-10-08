import { createFileRoute } from "@tanstack/react-router";

import type { PoetryTranslationMode } from "~/bindings";
import SettingsPage from "~/features/settings/SettingsPage";

interface SettingsSearch {
  panel?: "ai" | "data";
  returnUid?: string;
  returnQ?: string;
  returnMode?: PoetryTranslationMode;
}

function SettingsRoute() {
  return <SettingsPage returnContext={Route.useSearch()} />;
}

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
    panel:
      search.panel === "ai" || search.panel === "data"
        ? search.panel
        : undefined,
    returnUid:
      typeof search.returnUid === "string" ? search.returnUid : undefined,
    returnQ: typeof search.returnQ === "string" ? search.returnQ : undefined,
    returnMode:
      search.returnMode === "literary" || search.returnMode === "literal"
        ? search.returnMode
        : undefined,
  }),
  component: SettingsRoute,
});
