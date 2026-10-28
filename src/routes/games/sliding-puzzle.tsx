import { createFileRoute } from "@tanstack/react-router";

import SlidingPuzzleGame from "~/features/games/sliding-puzzle/SlidingPuzzleGame";
import { useRememberPage } from "~/features/navigation/use-remember-tool";

function SlidingPuzzleRoute() {
  useRememberPage("sliding-puzzle");
  return <SlidingPuzzleGame />;
}

export const Route = createFileRoute("/games/sliding-puzzle")({
  component: SlidingPuzzleRoute,
});
