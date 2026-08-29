import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import BtTool from "~/features/bt/BtTool";
import { useSettingsStore } from "~/store/settings";

function BtRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);

  useEffect(() => {
    setLastTool("bt");
  }, [setLastTool]);

  return <BtTool />;
}

export const Route = createFileRoute("/tools/bt")({
  component: BtRoute,
});
