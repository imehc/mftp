import { createFileRoute } from "@tanstack/react-router";

import BtTool from "~/features/bt/BtTool";
import { useRememberTool } from "~/features/navigation/use-remember-tool";
import { btAvailableGuard } from "~/lib/platform";

function BtRoute() {
  useRememberTool("bt");

  return <BtTool />;
}

export const Route = createFileRoute("/tools/bt")({
  beforeLoad: btAvailableGuard,
  component: BtRoute,
});
