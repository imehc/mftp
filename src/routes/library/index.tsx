import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import LibraryMobilePage from "~/features/poetry/LibraryMobilePage";
import LibraryPage from "~/features/poetry/LibraryPage";
import { isMobilePlatform } from "~/lib/platform";
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

  const search = Route.useSearch();
  const onSearchChange = (patch: { q?: string }) =>
    void navigate({
      to: "/library",
      search: (prev) => ({ ...prev, ...patch }),
    });
  if (isMobilePlatform()) {
    return (
      <LibraryMobilePage
        search={search}
        onSearchChange={onSearchChange}
        onOpenPoem={(uid) =>
          void navigate({
            to: "/library/$id",
            params: { id: uid },
            search: { q: search.q },
          })
        }
      />
    );
  }
  return (
    <LibraryPage
      search={search}
      onSearchChange={onSearchChange}
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
  component: LibraryRoute,
});
