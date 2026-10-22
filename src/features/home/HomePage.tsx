import { useLingui } from "@lingui/react/macro";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Gamepad2 } from "lucide-react";
import { useEffect, useEffectEvent, useRef } from "react";

import AppPageContent from "~/components/AppPageContent";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import { useSettingsStore } from "~/store/settings";

import {
  availableHomeEntries,
  type HomeCategory,
  homeCategoryLabels,
  orderedHomeEntries,
} from "./entries";
import { homeDescriptions } from "./home-descriptions";
import HomeRecentActivity from "./HomeRecentActivity";

export default function HomePage({ category }: { category?: HomeCategory }) {
  const { t } = useLingui();
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
  const lastTapAt = useRef(0);

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
      <ToolPageHeader
        showHome={false}
        title={
          <span
            title={t`双击或按 ⌘/Ctrl + . 显示或隐藏小游戏`}
            onPointerDown={() => {
              const now = performance.now();
              if (now - lastTapAt.current < 300) {
                lastTapAt.current = 0;
                const next = !showGames;
                setShowGames(next);
                void navigate({
                  to: "/",
                  search: { category: next ? "games" : "tools" },
                });
              } else lastTapAt.current = now;
            }}
          >
            {homeCategoryLabels[selected]}
          </span>
        }
        trailing={
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            aria-label={showGames ? t`隐藏小游戏` : t`显示小游戏`}
            title={showGames ? t`隐藏小游戏` : t`显示小游戏`}
            onClick={toggleGames}
          >
            <Gamepad2 />
          </Button>
        }
      />
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
                    <span className="text-muted-foreground mt-1 block text-xs">
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
        <HomeRecentActivity />
      </AppPageContent>
    </main>
  );
}
