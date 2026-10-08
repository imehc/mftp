import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useEffectEvent, useRef } from "react";

import { ToolPageHeader } from "~/components/ToolPageHeader";
import ActivityMenu from "~/features/transfers/ActivityMenu";
import { toolRouteOf } from "~/lib/module-metadata";
import { useSettingsStore } from "~/store/settings";

import {
  availableHomeEntries,
  type HomeCategory,
  homeCategoryLabels,
} from "./entries";
import { homeDescriptions } from "./home-descriptions";
import HomeRecentActivity from "./HomeRecentActivity";

export default function HomePage({ category }: { category?: HomeCategory }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const showGames = useSettingsStore((s) => s.showGames);
  const setShowGames = useSettingsStore((s) => s.setShowGames);
  const setLastTool = useSettingsStore((s) => s.setLastTool);
  const selected =
    category === "games" && !showGames ? "tools" : (category ?? "tools");
  const entries = availableHomeEntries.filter(
    (entry) => entry.category === selected,
  );
  const lastTapAt = useRef(0);
  // 保留既有快捷入口；分类放在路由中，使导航选中态与页面一致。
  const toggleGames = useEffectEvent(() => {
    const next = !showGames;
    setShowGames(next);
    void navigate({ to: "/", search: { category: next ? "games" : "tools" } });
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ".") {
        event.preventDefault();
        toggleGames();
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
        trailing={<ActivityMenu />}
      />
      <div className="app-scroll-safe-end min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 pt-4 md:px-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-sm font-semibold">
              {selected === "tools" ? (
                <Trans>全部工具</Trans>
              ) : (
                homeCategoryLabels[selected]
              )}
            </h1>
            <span className="text-muted-foreground text-xs">
              {entries.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {entries.map((entry) => {
              const Icon = entry.icon;
              const tool = toolRouteOf(entry.id);
              return (
                <Link
                  key={entry.id}
                  {...entry.link}
                  onClick={() => (tool ? setLastTool(tool) : undefined)}
                  className="bg-card hover:bg-accent focus-visible:ring-ring flex min-h-20 min-w-0 items-center gap-3 rounded-xl border p-3 outline-none focus-visible:ring-2"
                >
                  <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {entry.title}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {homeDescriptions[entry.id]}
                    </span>
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
        </div>
      </div>
    </main>
  );
}
