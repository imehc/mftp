import { createFileRoute } from "@tanstack/react-router";
import type { HomeCategory } from "~/features/home/entries";
import HomePage from "~/features/home/HomePage";

export const Route = createFileRoute("/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { category?: HomeCategory } => ({
    category:
      search.category === "tools" ||
      search.category === "library" ||
      search.category === "games"
        ? search.category
        : undefined,
  }),
  component: HomeRoute,
});

function HomeRoute() {
  const { category } = Route.useSearch();
  return <HomePage category={category} />;
}
