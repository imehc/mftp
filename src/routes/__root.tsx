import {
  createRootRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";

import { ActivityProvider } from "~/features/activity/ActivityProvider";
import { MobileBackNavigation } from "~/features/navigation/MobileBackNavigation";
import ModuleNavigationFrame from "~/features/navigation/ModuleNavigationFrame";
import { navigationContext } from "~/features/navigation/navigation-context";
import { useStartupNavigation } from "~/features/navigation/use-startup-navigation";
import { useSettingsStore } from "~/store/settings";

function RootLayout() {
  useStartupNavigation();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const search = useRouterState({ select: (state) => state.location.search });
  const showGames = useSettingsStore((state) => state.showGames);
  const navigation = navigationContext(pathname, search, showGames);
  return (
    <ActivityProvider>
      <MobileBackNavigation />
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
