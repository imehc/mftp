import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import VaultTool from "~/features/vault/VaultTool";
import { useSettingsStore } from "~/store/settings";

function VaultRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);

  useEffect(() => {
    setLastTool("vault");
  }, [setLastTool]);

  return <VaultTool />;
}

export const Route = createFileRoute("/tools/vault")({
  component: VaultRoute,
});
