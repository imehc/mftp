import type { NavigationItem } from "./NavigationItems";

interface NavigationContext {
  pathname: string;
  homeCategory?: string;
  showGames: boolean;
  selectedPoem?: string;
  settingsDetail: boolean;
}

interface NavigationPresentation {
  active: NavigationItem["id"];
  primary: boolean;
}

/** 路由族决定展示框架，具体模块的可用平台仍由路由守卫负责。 */
export function resolveNavigation({
  pathname,
  homeCategory,
  showGames,
  selectedPoem,
  settingsDetail,
}: NavigationContext): NavigationPresentation | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") {
    return {
      active:
        homeCategory === "library"
          ? "library"
          : homeCategory === "games" && showGames
            ? "games"
            : "tools",
      primary: true,
    };
  }
  if (path === "/library" || path.startsWith("/library/")) {
    return { active: "library", primary: path === "/library" && !selectedPoem };
  }
  if (path === "/settings" || path === "/logs" || path === "/about") {
    return {
      active: "settings",
      primary: path === "/settings" && !settingsDetail,
    };
  }
  if (path.startsWith("/games/")) return { active: "games", primary: false };
  // 新增工具只需进入 /tools 路由族，无需再修改根路由中的页面白名单。
  if (path.startsWith("/tools/") || path === "/preview") {
    return { active: "tools", primary: false };
  }
  return null;
}
