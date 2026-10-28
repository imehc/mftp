import { createFileRoute } from "@tanstack/react-router";

import ChessGame from "~/features/games/chess/ChessGame";
import { useRememberPage } from "~/features/navigation/use-remember-tool";

function ChessPage() {
  useRememberPage("chess");
  return <ChessGame />;
}

export const Route = createFileRoute("/games/chess")({ component: ChessPage });
