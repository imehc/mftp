import { createFileRoute } from "@tanstack/react-router";

import CryptoTool from "~/features/crypto/CryptoTool";
import { useRememberTool } from "~/features/navigation/use-remember-tool";

function CryptoRoute() {
  useRememberTool("crypto");

  return <CryptoTool />;
}

export const Route = createFileRoute("/tools/crypto")({
  component: CryptoRoute,
});
