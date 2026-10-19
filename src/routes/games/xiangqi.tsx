import { createFileRoute } from "@tanstack/react-router";

import XiangqiGame from "~/features/games/xiangqi/XiangqiGame";
import { useRememberPage } from "~/features/navigation/use-remember-tool";

function XiangqiRoute() {
  useRememberPage("xiangqi");
  return <XiangqiGame />;
}

export const Route = createFileRoute("/games/xiangqi")({
  component: XiangqiRoute,
});
