import { createFileRoute } from "@tanstack/react-router";

import ReversiGame from "~/features/games/reversi/ReversiGame";
import { useRememberPage } from "~/features/navigation/use-remember-tool";

function ReversiPage() {
  useRememberPage("reversi");
  return <ReversiGame />;
}

export const Route = createFileRoute("/games/reversi")({
  component: ReversiPage,
});
