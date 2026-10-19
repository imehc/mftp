import {
  currentHomePlatform,
  homeEntriesForPlatform,
  type HomePlatform,
} from "~/features/home/entries";
import type { ModuleId } from "~/lib/module-metadata";
import type {
  HomeCategoryId,
  HomeEntryVisibility,
  StartupMode,
} from "~/store/settings";

interface StartupVisibility {
  visibility: HomeEntryVisibility;
  hiddenCategories: readonly HomeCategoryId[];
  showGames: boolean;
  platform?: HomePlatform;
}

/** 手动选择与启动恢复共用平台、分类和单项可见性校验。 */
export function startupPages({
  visibility,
  hiddenCategories,
  showGames,
  platform = currentHomePlatform,
}: StartupVisibility) {
  return homeEntriesForPlatform(platform).filter(
    (entry) =>
      !hiddenCategories.includes(entry.category) &&
      (entry.category !== "games" || showGames) &&
      visibility[entry.id] !== false,
  );
}

export function startupEntry({
  mobile,
  pathname,
  search,
  mode,
  manualPage,
  lastPage,
  visibility,
  hiddenCategories,
  showGames,
  platform,
}: StartupVisibility & {
  mobile: boolean;
  pathname: string;
  search: string;
  mode: StartupMode;
  manualPage: ModuleId | null;
  lastPage: ModuleId | null;
}) {
  if (mobile || pathname !== "/" || search) return undefined;
  const page =
    mode === "manual" ? manualPage : mode === "last" ? lastPage : null;
  if (!page) return undefined;
  return startupPages({
    visibility,
    hiddenCategories,
    showGames,
    platform,
  }).find((entry) => entry.id === page);
}
