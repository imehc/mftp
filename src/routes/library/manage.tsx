import { createFileRoute } from "@tanstack/react-router";

import { useRememberTool } from "~/features/navigation/use-remember-tool";
import LibraryManagePage from "~/features/poetry/LibraryManagePage";
import { parsePoetryManageSearch } from "~/features/poetry/reading-navigation";

function LibraryManageRoute() {
  useRememberTool("library");
  const search = Route.useSearch();

  return <LibraryManagePage search={search} />;
}

export const Route = createFileRoute("/library/manage")({
  validateSearch: parsePoetryManageSearch,
  component: LibraryManageRoute,
});
