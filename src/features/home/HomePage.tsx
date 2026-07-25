import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import {
  Activity,
  ArrowRight,
  FileClock,
  Home,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import {
  availableHomeEntries,
  homeCategoryLabels,
  type HomeCategory,
  type HomeStats,
} from "~/features/home/entries";
import AppSettingsMenu from "~/features/settings/AppSettingsMenu";
import TransferPanel from "~/features/transfers/TransferPanel";
import { useHostsStore } from "~/store/hosts";
import { useSessionsStore } from "~/store/sessions";
import { useSettingsStore } from "~/store/settings";
import { useTransfersStore } from "~/store/transfers";

export default function HomePage() {
  const hosts = useHostsStore((s) => s.hosts);
  const sessions = useSessionsStore((s) => s.sessions);
  const transfers = useTransfersStore((s) => s.transfers);
  const setLastTool = useSettingsStore((s) => s.setLastTool);
  const showGames = useSettingsStore((s) => s.showGames);
  const setShowGames = useSettingsStore((s) => s.setShowGames);
  const [activeTab, setActiveTab] = useState<HomeCategory>("tools");
  const longPressTimer = useRef<number | null>(null);

  // The games tab is hidden by default; ⌘/Ctrl+. toggles it (desktop),
  // long-pressing the MFTP header title does the same (mobile).
  const toggleGames = () => {
    const next = !showGames;
    setShowGames(next);
    setActiveTab(next ? "games" : "tools");
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ".") {
        event.preventDefault();
        toggleGames();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const startLongPress = () => {
    cancelLongPress();
    longPressTimer.current = window.setTimeout(toggleGames, 600);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const activeSessions = sessions.filter(
    (session) =>
      session.status === "connecting" || session.status === "connected",
  );
  const runningTransfers = transfers.filter(
    (transfer) => transfer.status === "running",
  );
  const failedTransfers = transfers.filter(
    (transfer) => transfer.status === "error",
  );
  const hasActivity =
    activeSessions.length > 0 ||
    runningTransfers.length > 0 ||
    failedTransfers.length > 0;

  const stats: HomeStats = {
    hostCount: hosts.length,
    activeSessionCount: activeSessions.length,
    runningTransferCount: runningTransfers.length,
  };

  const categories = [
    ...new Set(availableHomeEntries.map((entry) => entry.category)),
  ] as HomeCategory[];

  return (
    <main className="h-full overflow-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-2.5 px-2.5 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
        <header className="flex items-center justify-between gap-2 border-b border-border pb-2">
          <div
            className="flex min-w-0 items-center gap-2"
            title="⌘/Ctrl + . 显示或隐藏小游戏"
            onPointerDown={startLongPress}
            onPointerUp={cancelLongPress}
            onPointerLeave={cancelLongPress}
            onPointerCancel={cancelLongPress}
          >
            <div className="flex size-8 items-center justify-center rounded-md border border-border bg-card">
              <Home className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">MFTP</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">
                <Trans>工具与运行状态</Trans>
              </p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
            <Badge variant={hasActivity ? "secondary" : "outline"}>
              <Activity data-icon="inline-start" />
              {hasActivity ? <Trans>活动中</Trans> : <Trans>空闲</Trans>}
            </Badge>
            <Badge variant="outline">
              <Trans>{activeSessions.length} 连接</Trans>
            </Badge>
            <Badge variant="outline">
              <Trans>{runningTransfers.length} 传输</Trans>
            </Badge>
            {failedTransfers.length > 0 ? (
              <Badge variant="destructive">
                <Trans>{failedTransfers.length} 失败</Trans>
              </Badge>
            ) : null}
            <Button variant="outline" size="sm" asChild>
              <Link to="/logs" preload="viewport">
                <FileClock data-icon="inline-start" />
                <Trans>日志</Trans>
              </Link>
            </Button>
            <AppSettingsMenu />
          </div>
        </header>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as HomeCategory)}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          {(() => {
            const visibleCategories = showGames
              ? categories
              : categories.filter((category) => category !== "games");
            return (
              <>
                {visibleCategories.length > 1 ? (
                  <TabsList>
                    {visibleCategories.map((category) => (
                      <TabsTrigger key={category} value={category}>
                        {homeCategoryLabels[category]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                ) : null}
                {visibleCategories.map((category) => (
                  <TabsContent key={category} value={category}>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-2">
                      {availableHomeEntries
                        .filter((entry) => entry.category === category)
                        .map((entry) => {
                          const Icon = entry.icon;
                          return (
                            <Link
                              key={entry.id}
                              {...entry.link}
                              onClick={() =>
                                entry.toolId
                                  ? setLastTool(entry.toolId)
                                  : undefined
                              }
                              className="group flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:bg-accent hover:text-accent-foreground"
                            >
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background group-hover:bg-background">
                                  <Icon className="size-4" />
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold">
                                    {entry.title}
                                  </span>
                                  {entry.badges ? (
                                    <span className="mt-1 flex flex-wrap gap-1.5">
                                      {entry.badges(stats)}
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                              <ArrowRight className="size-4 shrink-0 text-muted-foreground group-hover:text-accent-foreground" />
                            </Link>
                          );
                        })}
                    </div>
                  </TabsContent>
                ))}
              </>
            );
          })()}

          {/* Spacer pushes the transfer list to the bottom of the viewport. */}
          <div className="flex-1" />

          <TransferPanel />
        </Tabs>
      </div>
    </main>
  );
}
