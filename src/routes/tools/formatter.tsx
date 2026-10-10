import { createFileRoute } from "@tanstack/react-router";

import FormatterTool from "~/features/formatter/FormatterTool";
import { useRememberTool } from "~/features/navigation/use-remember-tool";

function FormatterRoute() {
  useRememberTool("formatter");

  return <FormatterTool />;
}

export const Route = createFileRoute("/tools/formatter")({
  component: FormatterRoute,
});
