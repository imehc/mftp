import { createFileRoute } from "@tanstack/react-router";

import { useRememberTool } from "~/features/navigation/use-remember-tool";
import LibraryManagePage from "~/features/poetry/LibraryManagePage";

interface LibraryManageSearch {
  /** 来源列表的检索词与所选诗词；返回 /library 时原样带回，保留查询上下文。 */
  q?: string;
  poem?: string;
}

function LibraryManageRoute() {
  useRememberTool("library");
  const search = Route.useSearch();

  return <LibraryManagePage search={search} />;
}

export const Route = createFileRoute("/library/manage")({
  validateSearch: (search: Record<string, unknown>): LibraryManageSearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
    poem: typeof search.poem === "string" ? search.poem : undefined,
  }),
  component: LibraryManageRoute,
});
