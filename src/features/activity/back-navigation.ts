import { linkOptions } from "@tanstack/react-router";

export function activityBackLink(search: Record<string, unknown>) {
  return search.operation || search.history
    ? linkOptions({ to: "/activity", search: { tab: "logs" } })
    : linkOptions({ to: "/" });
}
