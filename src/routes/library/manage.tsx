import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import LibraryManagePage from "~/features/poetry/LibraryManagePage";
import { desktopOnlyGuard } from "~/lib/platform";
import { useSettingsStore } from "~/store/settings";

function LibraryManageRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);

  useEffect(() => {
    setLastTool("library");
  }, [setLastTool]);

  return <LibraryManagePage />;
}

export const Route = createFileRoute("/library/manage")({
  beforeLoad: desktopOnlyGuard,
  component: LibraryManageRoute,
});
