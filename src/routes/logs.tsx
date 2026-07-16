import { createFileRoute } from "@tanstack/react-router";
import ActivityLogsPage from "~/features/logs/ActivityLogsPage";

export const Route = createFileRoute("/logs")({
  component: ActivityLogsPage,
});
