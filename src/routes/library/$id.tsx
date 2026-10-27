import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { useRememberTool } from "~/features/navigation/use-remember-tool";
import { usePoetryReadingRoute } from "~/features/poetry/hooks/use-poetry-reading-route";
import PoemDetailPage from "~/features/poetry/PoemDetailPage";
import {
  type PoetryReadingView,
  resolvePoetryReadingView,
} from "~/features/poetry/reading-view";

interface LibraryPoemSearch {
  q?: string;
  view?: PoetryReadingView;
}

/**
 * 独立详情路由：桌面端 UI 在 `/library` 右侧面板展示详情，但直接链接
 *（例如某个合集重新同步后）仍必须能渲染出完整页面。
 */
function LibraryPoemRoute() {
  useRememberTool("library");
  const navigate = useNavigate();
  const uid = Route.useParams().id;
  const { q, view: explicitView } = Route.useSearch();
  const view = usePoetryReadingRoute({
    page: "detail",
    uid,
    q,
    view: explicitView,
  });

  return (
    <PoemDetailPage
      uid={uid}
      backQuery={q}
      view={view}
      onViewChange={(nextView) => {
        void navigate({
          to: "/library/$id",
          params: { id: uid },
          search: (current) => ({ ...current, view: nextView }),
          replace: true,
        });
      }}
    />
  );
}

export const Route = createFileRoute("/library/$id")({
  validateSearch: (search: Record<string, unknown>): LibraryPoemSearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
    view: resolvePoetryReadingView(search.view, search.mode),
  }),
  component: LibraryPoemRoute,
});
