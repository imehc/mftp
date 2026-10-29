import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useEffectEvent } from "react";

import AppPageContent from "~/components/AppPageContent";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { useSettingsStore } from "~/store/settings";

import {
  availableHomeEntries,
  type HomeCategory,
  homeCategoryLabels,
  orderedHomeEntries,
} from "./entries";
import { homeDescriptions } from "./home-descriptions";

export default function HomePage({ category }: { category?: HomeCategory }) {
  const navigate = useNavigate();
  const showGames = useSettingsStore((s) => s.showGames);
  const homeEntryVisibility = useSettingsStore((s) => s.homeEntryVisibility);
  const hiddenHomeCategories = useSettingsStore((s) => s.hiddenHomeCategories);
  const homeEntryOrder = useSettingsStore((s) => s.homeEntryOrder);
  const setShowGames = useSettingsStore((s) => s.setShowGames);
  const selected =
    category === "games" && !showGames ? "tools" : (category ?? "tools");
  const entries = orderedHomeEntries(
    selected,
    homeEntryOrder[selected],
    availableHomeEntries,
  )
    .filter((entry) => homeEntryVisibility[entry.id] !== false)
    .filter(() => !hiddenHomeCategories.includes(selected));

  // 分类放在路由中，使导航选中态与页面一致。
  const toggleGames = () => {
    const next = !showGames;
    setShowGames(next);
    void navigate({ to: "/", search: { category: next ? "games" : "tools" } });
  };

  // 快捷键监听只注册一次，通过 Effect Event 读取最新的 toggleGames。
  const handleGamesShortcut = useEffectEvent(() => {
    toggleGames();
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ".") {
        event.preventDefault();
        handleGamesShortcut();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background flex h-full min-h-0 flex-col"
    >
      <ToolPageHeader showHome={false} title={homeCategoryLabels[selected]} />
      <AppPageContent bottomInset="scroll">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry) => {
            const Icon = entry.icon;
            const description = homeDescriptions[entry.id];
            return (
              <Link
                key={entry.id}
                {...entry.link}
                className="bg-card hover:bg-accent focus-visible:ring-ring flex min-h-20 min-w-0 items-center gap-3 rounded-xl border p-3 outline-none focus-visible:ring-2"
              >
                <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {entry.title}
                  </span>
                  {description ? (
                    <span className="app-description mt-1 block">
                      {description}
                    </span>
                  ) : null}
                </span>
                <ChevronRight
                  aria-hidden
                  className="text-muted-foreground size-4 shrink-0"
                />
              </Link>
            );
          })}
        </div>
      </AppPageContent>
    </main>
  );
}
