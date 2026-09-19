import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import LibraryMobileManagePage from "~/features/poetry/LibraryMobileManagePage";
import LibraryManagePage from "~/features/poetry/LibraryManagePage";
import { isMobilePlatform } from "~/lib/platform";
import { useSettingsStore } from "~/store/settings";

function LibraryManageRoute() {
  const setLastTool = useSettingsStore((s) => s.setLastTool);

  useEffect(() => {
    setLastTool("library");
  }, [setLastTool]);

  return isMobilePlatform() ? (
    <LibraryMobileManagePage />
  ) : (
    <LibraryManagePage />
  );
}

export const Route = createFileRoute("/library/manage")({
  component: LibraryManageRoute,
});
