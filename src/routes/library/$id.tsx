import { createFileRoute, useNavigate } from "@tanstack/react-router";

import type { PoetryTranslationMode } from "~/bindings";
import { useRememberTool } from "~/features/navigation/use-remember-tool";
import PoemDetailPage from "~/features/poetry/PoemDetailPage";

interface LibraryPoemSearch {
  q?: string;
  mode?: PoetryTranslationMode;
}

/**
 * 独立详情路由：桌面端 UI 在 `/library` 右侧面板展示详情，但直接链接
 *（例如某个合集重新同步后）仍必须能渲染出完整页面。
 */
function LibraryPoemRoute() {
  useRememberTool("library");
  const navigate = useNavigate();
  const uid = Route.useParams().id;
  const { q, mode } = Route.useSearch();

  return (
    <PoemDetailPage
      uid={uid}
      backQuery={q}
      initialTranslationMode={mode}
      onTranslationModeChange={(nextMode: PoetryTranslationMode) => {
        void navigate({
          to: "/library/$id",
          params: { id: uid },
          search: (current) => ({ ...current, mode: nextMode }),
          replace: true,
        });
      }}
    />
  );
}

export const Route = createFileRoute("/library/$id")({
  validateSearch: (search: Record<string, unknown>): LibraryPoemSearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
    mode:
      search.mode === "literary" || search.mode === "literal"
        ? search.mode
        : undefined,
  }),
  component: LibraryPoemRoute,
});
