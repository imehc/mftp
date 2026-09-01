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
    // 移动端始终从首页启动，这样系统的返回手势会回到首页，
    // 而不是退出应用。
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
