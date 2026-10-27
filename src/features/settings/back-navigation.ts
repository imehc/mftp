import { linkOptions } from "@tanstack/react-router";

import { poetryReadingLink } from "~/features/poetry/reading-navigation";
import { resolvePoetryReadingView } from "~/features/poetry/reading-view";

export function settingsBackLink(search: Record<string, unknown>) {
  if (typeof search.returnUid === "string" && search.returnUid) {
    return poetryReadingLink({
      page: search.returnPage === "library" ? "library" : "detail",
      uid: search.returnUid,
      q: typeof search.returnQ === "string" ? search.returnQ : undefined,
      view: resolvePoetryReadingView(search.returnView),
    });
  }
  return linkOptions({ to: "/settings", search: {} });
}
