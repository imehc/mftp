import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import LibraryPage from "~/features/poetry/LibraryPage";
import { desktopOnlyGuard } from "~/lib/platform";
import { useSettingsStore } from "~/store/settings";

interface LibrarySearch {
  /** Inline full-text query; kept in the URL for back/share. */
  q?: string;
  /** Selected poem uid shown in the detail pane (desktop master-detail). */
  poem?: string;
}

function LibraryRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);
  const navigate = useNavigate();

  useEffect(() => {
    setLastTool("library");
  }, [setLastTool]);

  return (
    <LibraryPage
      search={Route.useSearch()}
      onSearchChange={(patch) =>
        void navigate({ to: "/library", search: (prev) => ({ ...prev, ...patch }) })
      }
      onOpenPoem={(uid) =>
        void navigate({
          to: "/library",
          search: (prev) => ({ ...prev, poem: uid }),
        })
      }
    />
  );
}

export const Route = createFileRoute("/library/")({
  validateSearch: (search: Record<string, unknown>): LibrarySearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
    poem: typeof search.poem === "string" ? search.poem : undefined,
  }),
  beforeLoad: desktopOnlyGuard,
  component: LibraryRoute,
});
