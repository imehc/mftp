import { createFileRoute } from "@tanstack/react-router";
import BilliardsGame from "~/features/games/billiards/BilliardsGame";

export const Route = createFileRoute("/games/billiards")({
  component: BilliardsGame,
});
