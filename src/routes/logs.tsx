import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/logs")({
  beforeLoad: () => {
    throw redirect({ to: "/activity", search: { tab: "logs" }, replace: true });
  },
});
