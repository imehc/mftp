import { useEffect } from "react";
import {
  Outlet,
  createRootRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { getToolEntry } from "~/features/home/entries";
import { isMobilePlatform } from "~/lib/platform";
import { useSettingsStore } from "~/store/settings";
import ModuleNavigationFrame from "~/features/navigation/ModuleNavigationFrame";

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
  // 按模块迁移：已完成的模块接入新骨架，其他页面在各自阶段接入。
  const home = pathname === "/";
  const homeCategory = useRouterState({
    select: (state) => state.location.search.category,
  });
  const showGames = useSettingsStore((state) => state.showGames);
  const settings = pathname === "/settings";
  const logs = pathname === "/logs";
  const about = pathname === "/about";
  const preview = pathname === "/preview";
  const library = pathname === "/library" || pathname.startsWith("/library/");
  const games = pathname.startsWith("/games/");
  const bt = pathname === "/tools/bt";
  const vault = pathname === "/tools/vault";
  const formatter = pathname === "/tools/formatter";
  const media = pathname === "/tools/media-compress";
  const modelViewer = pathname === "/tools/model-viewer";
  const crypto = pathname === "/tools/crypto";
  const lan = pathname === "/tools/lan-transfer";
  const ssh = pathname === "/tools/ssh-sftp";
  const todo = pathname === "/tools/todo";
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
      {library ||
      bt ||
      games ||
      settings ||
      todo ||
      home ||
      ssh ||
      lan ||
      crypto ||
      media ||
      modelViewer ||
      formatter ||
      vault ||
      logs ||
      about ||
      preview ? (
        <ModuleNavigationFrame
          active={
            home && homeCategory === "games" && showGames
              ? "games"
              : home && homeCategory === "library"
                ? "library"
                : library
                  ? "library"
                  : games
                    ? "games"
                    : settings || logs || about
                      ? "settings"
                      : "tools"
          }
          primary={
            home ||
            (library &&
              (pathname === "/library" || pathname === "/library/") &&
              !selectedPoem) ||
            (settings && !settingsDetail)
          }
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
