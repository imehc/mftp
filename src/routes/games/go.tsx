import { createFileRoute } from "@tanstack/react-router";

import GoGame from "~/features/games/go/GoGame";
import { useRememberPage } from "~/features/navigation/use-remember-tool";

function GoRoute() {
  useRememberPage("go");
  return <GoGame />;
}

export const Route = createFileRoute("/games/go")({
  component: GoRoute,
});
