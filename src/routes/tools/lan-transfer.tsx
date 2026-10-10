import { createFileRoute } from "@tanstack/react-router";

import LanTransferTool from "~/features/lan-transfer/LanTransferTool";
import { useRememberTool } from "~/features/navigation/use-remember-tool";
import { desktopOnlyGuard } from "~/lib/platform";

function LanTransferRoute() {
  useRememberTool("lan-transfer");

  return <LanTransferTool />;
}

export const Route = createFileRoute("/tools/lan-transfer")({
  beforeLoad: desktopOnlyGuard,
  component: LanTransferRoute,
});
