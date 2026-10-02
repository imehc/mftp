import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import LibraryPage from "~/features/poetry/LibraryPage";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import { useSettingsStore } from "~/store/settings";

interface LibrarySearch {
  /** 内联全文检索词；保留在 URL 中以便返回 / 分享。 */
  q?: string;
  /** 在详情面板中展示的所选诗词 uid（桌面端主从布局）。 */
  poem?: string;
}

function LibraryRoute() {
  const desktop = useDesktopLayout();
  const setLastTool = useSettingsStore((s) => s.setLastTool);
  const navigate = useNavigate();

  useEffect(() => {
    setLastTool("library");
  }, [setLastTool]);

  const search = Route.useSearch();
  const onSearchChange = (patch: { q?: string }) =>
    void navigate({
      to: "/library",
      replace: true,
      search: (prev) => ({ ...prev, ...patch }),
    });
  return (
    <LibraryPage
      search={search}
      onSearchChange={onSearchChange}
      onOpenPoem={(uid) => {
        if (!desktop && uid) {
          void navigate({
            to: "/library/$id",
            params: { id: uid },
            search: { q: search.q },
          });
          return;
        }
        void navigate({
          to: "/library",
          // 空 uid 表示关掉详情（窄桌面单栏用返回按钮触发），要真正去掉参数。
          search: (prev) => ({ ...prev, poem: uid || undefined }),
        });
      }}
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
