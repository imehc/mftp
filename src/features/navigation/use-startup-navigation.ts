import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { isMobilePlatform } from "~/lib/platform";
import { useSettingsStore } from "~/store/settings";

import { startupEntry } from "./startup";

const START_ROUTE_RESOLVED_KEY = "mftp-start-route-resolved";

export function useStartupNavigation() {
  const navigate = useNavigate();
  useEffect(() => {
    if (sessionStorage.getItem(START_ROUTE_RESOLVED_KEY)) return;
    sessionStorage.setItem(START_ROUTE_RESOLVED_KEY, "1");
    // 只读取启动时的偏好快照；修改开关不导航，显式深链接优先。
    const settings = useSettingsStore.getState();
    const entry = startupEntry({
      mobile: isMobilePlatform(),
      pathname: window.location.pathname,
      search: window.location.search,
      restore: settings.restoreLastTool,
      lastTool: settings.lastTool,
    });
    if (entry) void navigate({ ...entry.link, replace: true });
  }, [navigate]);
}
