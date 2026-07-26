import { createFileRoute } from "@tanstack/react-router";
import GomokuGame from "~/features/games/gomoku/GomokuGame";

export const Route = createFileRoute("/games/gomoku")({
  component: GomokuGame,
});
