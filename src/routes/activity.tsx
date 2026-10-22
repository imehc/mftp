import { createFileRoute } from "@tanstack/react-router";

import ActivityPage from "~/features/activity/ActivityPage";

interface ActivitySearch {
  tab?: "tasks" | "logs";
  operation?: string;
}

export const Route = createFileRoute("/activity")({
  validateSearch: (search: Record<string, unknown>): ActivitySearch => ({
    tab:
      search.tab === "logs"
        ? ("logs" as const)
        : search.tab === "tasks"
          ? ("tasks" as const)
          : undefined,
    operation:
      typeof search.operation === "string" ? search.operation : undefined,
  }),
  component: ActivityPage,
});
