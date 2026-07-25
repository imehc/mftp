import { useEffect } from "react";
import { Outlet, createRootRoute, useNavigate } from "@tanstack/react-router";
import { getToolEntry } from "~/features/home/entries";
import { isMobilePlatform } from "~/lib/platform";
import { useHostsStore } from "~/store/hosts";
import { useSettingsStore } from "~/store/settings";

const START_ROUTE_RESOLVED_KEY = "mftp-start-route-resolved";

function RootLayout() {
  const navigate = useNavigate();
  const loadAll = useHostsStore((s) => s.loadAll);
  const lastTool = useSettingsStore((s) => s.lastTool);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (sessionStorage.getItem(START_ROUTE_RESOLVED_KEY)) return;
    sessionStorage.setItem(START_ROUTE_RESOLVED_KEY, "1");
    // On mobile, always start at home so the system back gesture returns
    // there instead of exiting the app.
    if (isMobilePlatform()) return;
    if (window.location.pathname !== "/" || !lastTool) return;
    const entry = getToolEntry(lastTool);
    if (!entry) return;
    void navigate({ ...entry.link, replace: true });
  }, [lastTool, navigate]);

  return (
    <div className="app-shell">
      <Outlet />
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
