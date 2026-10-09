import {
  createRootRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";

import { getToolEntry } from "~/features/home/entries";
import ModuleNavigationFrame from "~/features/navigation/ModuleNavigationFrame";
import { resolveNavigation } from "~/features/navigation/resolve-navigation";
import { isMobilePlatform } from "~/lib/platform";
import { useSettingsStore } from "~/store/settings";

const START_ROUTE_RESOLVED_KEY = "mftp-start-route-resolved";

function RootLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const selectedPoem = useRouterState({
    select: (state) => state.location.search.poem,
  });
  const settingsDetail = useRouterState({
    select: (state) =>
      state.location.search.panel === "ai" ||
      state.location.search.panel === "data" ||
      !!state.location.search.returnUid,
  });
  const homeCategory = useRouterState({
    select: (state) => state.location.search.category,
  });
  const showGames = useSettingsStore((state) => state.showGames);
  const navigation = resolveNavigation({
    pathname,
    homeCategory,
    showGames,
    selectedPoem,
    settingsDetail,
  });
  const lastTool = useSettingsStore((s) => s.lastTool);

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
      {navigation ? (
        <ModuleNavigationFrame
          active={navigation.active}
          primary={navigation.primary}
        >
          <Outlet />
        </ModuleNavigationFrame>
      ) : (
        <Outlet />
      )}
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
