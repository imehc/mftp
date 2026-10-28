import { createFileRoute } from "@tanstack/react-router";

import MagicCubeGame from "~/features/games/magic-cube/MagicCubeGame";
import { useRememberPage } from "~/features/navigation/use-remember-tool";

function MagicCubeRoute() {
  useRememberPage("magic-cube");
  return <MagicCubeGame />;
}

export const Route = createFileRoute("/games/magic-cube")({
  component: MagicCubeRoute,
});
