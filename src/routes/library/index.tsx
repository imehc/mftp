import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import { useRememberTool } from "~/features/navigation/use-remember-tool";
import {
  beginPoetryReading,
  usePoetryReadingRoute,
} from "~/features/poetry/hooks/use-poetry-reading-route";
import LibraryPage from "~/features/poetry/LibraryPage";
import {
  parsePoetryLibrarySearch,
  poetryResumeLink,
} from "~/features/poetry/reading-navigation";
import type { PoetryReadingView } from "~/features/poetry/reading-view";
import { useDesktopLayout } from "~/lib/use-desktop-layout";

function LibraryRoute() {
  const desktop = useDesktopLayout();
  useRememberTool("library");
  const navigate = useNavigate();

  const search = Route.useSearch();
  const view = usePoetryReadingRoute({
    page: "library",
    uid: search.poem,
    q: search.q,
    view: search.view,
  });
  const onSearchChange = (patch: { q?: string; view?: PoetryReadingView }) =>
    void navigate({
      to: "/library",
      replace: true,
      search: (prev) => ({ ...prev, ...patch }),
    });
  return (
    <LibraryPage
      search={{ ...search, view }}
      onViewChange={(nextView) => onSearchChange({ view: nextView })}
      onSearchChange={onSearchChange}
      onOpenPoem={(uid) => {
        const nextView =
          uid && uid !== search.poem ? beginPoetryReading(uid) : view;
        if (!desktop && uid) {
          void navigate({
            to: "/library/$id",
            params: { id: uid },
            search: { q: search.q, view: nextView },
          });
          return;
        }
        void navigate({
          to: "/library",
          // 空 uid 表示关掉详情（窄桌面单栏用返回按钮触发），要真正去掉参数。
          search: (prev) => ({
            ...prev,
            poem: uid || undefined,
            view: nextView,
            resume: undefined,
          }),
        });
      }}
    />
  );
}

export const Route = createFileRoute("/library/")({
  validateSearch: parsePoetryLibrarySearch,
  beforeLoad: ({ search, preload }) => {
    if (preload) return;
    const destination = poetryResumeLink(search);
    if (destination) throw redirect({ ...destination, replace: true });
  },
  component: LibraryRoute,
});
