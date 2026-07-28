import { createFileRoute } from "@tanstack/react-router";
import XiangqiGame from "~/features/games/xiangqi/XiangqiGame";

export const Route = createFileRoute("/games/xiangqi")({
  component: XiangqiGame,
});
