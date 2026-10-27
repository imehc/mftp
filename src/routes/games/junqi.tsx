import { createFileRoute } from "@tanstack/react-router";

import JunqiGame from "~/features/games/junqi/JunqiGame";
import { useRememberPage } from "~/features/navigation/use-remember-tool";

function JunqiRoute() {
  useRememberPage("junqi");
  return <JunqiGame />;
}

export const Route = createFileRoute("/games/junqi")({ component: JunqiRoute });
