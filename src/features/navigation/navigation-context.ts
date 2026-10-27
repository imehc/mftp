import { resolveNavigation } from "./resolve-navigation";

/** 展示与系统返回共享语义，不能把键盘隐藏底栏当成离开一级页。 */
export function navigationContext(
  pathname: string,
  search: Record<string, unknown>,
  showGames: boolean,
) {
  return resolveNavigation({
    pathname,
    homeCategory:
      typeof search.category === "string" ? search.category : undefined,
    selectedPoem: typeof search.poem === "string" ? search.poem : undefined,
    settingsDetail:
      ["ai", "data", "features", "mcp"].includes(String(search.panel)) ||
      !!search.returnUid,
    showGames,
  });
}
