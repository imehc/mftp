import { createFileRoute } from "@tanstack/react-router";

import { useRememberTool } from "~/features/navigation/use-remember-tool";
import VaultTool from "~/features/vault/VaultTool";

function VaultRoute() {
  useRememberTool("vault");

  return <VaultTool />;
}

export const Route = createFileRoute("/tools/vault")({
  component: VaultRoute,
});
