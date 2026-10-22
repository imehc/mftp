import {
  createRootRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";

import { ActivityProvider } from "~/features/activity/ActivityProvider";
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
      state.location.search.panel === "features" ||
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
    <ActivityProvider>
      <div className="app-shell">
        {navigation ? (
          <ModuleNavigationFrame
            active={navigation.active}
            primary={navigation.primary}
          >
            <Outlet />
          </ModuleNavigationFrame>
        ) : (
          <div className="bg-background flex h-full min-h-0 flex-col">
            <div className="min-h-0 min-w-0 flex-1">
              <Outlet />
            </div>
          </div>
        )}
      </div>
    </ActivityProvider>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
