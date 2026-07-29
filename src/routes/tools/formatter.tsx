import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import FormatterTool from "~/features/formatter/FormatterTool";
import { useSettingsStore } from "~/store/settings";

function FormatterRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);

  useEffect(() => {
    setLastTool("formatter");
  }, [setLastTool]);

  return <FormatterTool />;
}

export const Route = createFileRoute("/tools/formatter")({
  component: FormatterRoute,
});
