import { Trans } from "@lingui/react/macro";
import { linkOptions } from "@tanstack/react-router";
import { BookOpen, Gamepad2, LayoutGrid, Settings } from "lucide-react";

import {
  availableHomeEntries,
  type HomeCategory,
  homeCategoryHasVisibleEntries,
  homeCategoryLabels,
} from "~/features/home/entries";
import type { HomeEntryVisibility } from "~/store/settings";

const icons = { tools: LayoutGrid, library: BookOpen, games: Gamepad2 };

/** 先按平台和可见性筛选，再决定分类直达还是展示已有首页分类。 */
export function navigationItems(
  showGames: boolean,
  hiddenCategories: readonly string[] = [],
  visibility: HomeEntryVisibility = {},
) {
  const categories = [
    ...new Set(availableHomeEntries.map((entry) => entry.category)),
  ];
  const items = categories
    .filter((category) => category !== "games" || showGames)
    .filter((category) => !hiddenCategories.includes(category))
    .filter((category) => homeCategoryHasVisibleEntries(category, visibility))
    .map((category) => {
      const entries = availableHomeEntries.filter(
        (entry) => entry.category === category,
      );
      return {
        id: category as HomeCategory | "settings",
        title: homeCategoryLabels[category],
        icon: icons[category],
        link:
          entries.length === 1
            ? entries[0].link
            : linkOptions({ to: "/", search: { category } }),
      };
    });
  return [
    ...items,
    {
      id: "settings" as const,
      title: <Trans>设置</Trans>,
      icon: Settings,
      link: linkOptions({ to: "/settings" }),
    },
  ];
}

export type NavigationItem = ReturnType<typeof navigationItems>[number];

export type NavigationSection = NavigationItem["id"] | "activity";
