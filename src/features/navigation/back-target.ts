import { linkOptions } from "@tanstack/react-router";

import { activityBackLink } from "~/features/activity/back-navigation";
import { poetryBackLink } from "~/features/poetry/back-navigation";
import { settingsBackLink } from "~/features/settings/back-navigation";

/** 没有有效来源历史时，父级由相应功能定义，禁止回退到外部文档。 */
export function fallbackBackLink(
  pathname: string,
  search: Record<string, unknown>,
) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/activity") return activityBackLink(search);
  if (path === "/library" || path.startsWith("/library/"))
    return poetryBackLink(path, search);
  if (path === "/settings" || path === "/about" || path === "/logs")
    return settingsBackLink(search);
  return linkOptions({
    to: "/",
    search: { category: path.startsWith("/games/") ? "games" : "tools" },
  });
}
