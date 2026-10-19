import { createFileRoute } from "@tanstack/react-router";

import GomokuGame from "~/features/games/gomoku/GomokuGame";
import { useRememberPage } from "~/features/navigation/use-remember-tool";

function GomokuRoute() {
  useRememberPage("gomoku");
  return <GomokuGame />;
}

export const Route = createFileRoute("/games/gomoku")({
  component: GomokuRoute,
});
