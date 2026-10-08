import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import LibraryManagePage from "~/features/poetry/LibraryManagePage";
import { useSettingsStore } from "~/store/settings";

interface LibraryManageSearch {
  /** 来源列表的检索词与所选诗词；返回 /library 时原样带回，保留查询上下文。 */
  q?: string;
  poem?: string;
}

function LibraryManageRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);
  const search = Route.useSearch();

  useEffect(() => {
    setLastTool("library");
  }, [setLastTool]);

  return <LibraryManagePage search={search} />;
}

export const Route = createFileRoute("/library/manage")({
  validateSearch: (search: Record<string, unknown>): LibraryManageSearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
    poem: typeof search.poem === "string" ? search.poem : undefined,
  }),
  component: LibraryManageRoute,
});
