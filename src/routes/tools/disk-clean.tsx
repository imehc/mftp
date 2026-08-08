import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import DiskCleanTool from "~/features/disk-clean/DiskCleanTool";
import { macosOnlyGuard } from "~/lib/platform";
import { useSettingsStore } from "~/store/settings";

function DiskCleanRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);

  useEffect(() => {
    setLastTool("disk-clean");
  }, [setLastTool]);

  return <DiskCleanTool />;
}

export const Route = createFileRoute("/tools/disk-clean")({
  // The `disk_clean_*` commands are only registered on macOS, so on any other
  // platform every call would fail at the IPC layer.
  beforeLoad: macosOnlyGuard,
  component: DiskCleanRoute,
});
