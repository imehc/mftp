import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import LanTransferTool from "~/features/lan-transfer/LanTransferTool";
import { desktopOnlyGuard } from "~/lib/platform";
import { useSettingsStore } from "~/store/settings";

function LanTransferRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);

  useEffect(() => {
    setLastTool("lan-transfer");
  }, [setLastTool]);

  return <LanTransferTool />;
}

export const Route = createFileRoute("/tools/lan-transfer")({
  beforeLoad: desktopOnlyGuard,
  component: LanTransferRoute,
});
