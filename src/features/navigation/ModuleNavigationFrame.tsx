import type { ReactNode } from "react";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import { useSettingsStore } from "~/store/settings";
import { navigationItems, type NavigationItem } from "./NavigationItems";
import NavigationRailDesktop from "./NavigationRail.desktop";
import BottomNavigationMobile from "./BottomNavigation.mobile";

/** 展示框架不拥有页面状态；换导航布局时 children 保持在同一挂载位置。 */
export default function ModuleNavigationFrame({
  children,
  active,
  primary,
}: {
  children: ReactNode;
  active: NavigationItem["id"];
  primary: boolean;
}) {
  const wide = useDesktopLayout();
  const showGames = useSettingsStore((state) => state.showGames);
  const items = navigationItems(showGames);
  return (
    <div
      data-bottom-inset="scroll"
      data-bottom-navigation={!wide && primary ? "visible" : undefined}
      className="flex h-full min-h-0"
    >
      {wide ? <NavigationRailDesktop items={items} active={active} /> : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 min-w-0 flex-1">{children}</div>
        {!wide && primary ? (
          <BottomNavigationMobile items={items} active={active} />
        ) : null}
      </div>
    </div>
  );
}
