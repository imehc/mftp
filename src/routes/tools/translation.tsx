import { createFileRoute } from "@tanstack/react-router";

import { useRememberTool } from "~/features/navigation/use-remember-tool";
import TranslationTool from "~/features/translation/TranslationTool";

function TranslationRoute() {
  useRememberTool("translation");

  return <TranslationTool />;
}

export const Route = createFileRoute("/tools/translation")({
  component: TranslationRoute,
});
