import {
  createRootRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";

import ModuleNavigationFrame from "~/features/navigation/ModuleNavigationFrame";
import { resolveNavigation } from "~/features/navigation/resolve-navigation";
import { useStartupNavigation } from "~/features/navigation/use-startup-navigation";
import { useSettingsStore } from "~/store/settings";

function RootLayout() {
  useStartupNavigation();
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
