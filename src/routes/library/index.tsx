import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import LibraryPage from "~/features/poetry/LibraryPage";
import { desktopOnlyGuard } from "~/lib/platform";
import { useSettingsStore } from "~/store/settings";

interface LibrarySearch {
  /** 内联全文检索词；保留在 URL 中以便返回 / 分享。 */
  q?: string;
  /** 在详情面板中展示的所选诗词 uid（桌面端主从布局）。 */
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
        void navigate({
          to: "/library",
          search: (prev) => ({ ...prev, ...patch }),
        })
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
