import { createFileRoute } from "@tanstack/react-router";

import BilliardsGame from "~/features/games/billiards/BilliardsGame";
import { useRememberPage } from "~/features/navigation/use-remember-tool";

function BilliardsRoute() {
  useRememberPage("billiards");
  return <BilliardsGame />;
}

export const Route = createFileRoute("/games/billiards")({
  component: BilliardsRoute,
});
