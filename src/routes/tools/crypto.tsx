import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import CryptoTool from "~/features/crypto/CryptoTool";
import { useSettingsStore } from "~/store/settings";

function CryptoRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);

  useEffect(() => {
    setLastTool("crypto");
  }, [setLastTool]);

  return <CryptoTool />;
}

export const Route = createFileRoute("/tools/crypto")({
  component: CryptoRoute,
});
