import { createFileRoute } from "@tanstack/react-router";
import GoGame from "~/features/games/go/GoGame";

export const Route = createFileRoute("/games/go")({
  component: GoGame,
});
