import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Activity, ArrowRight, FileClock, Home } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  availableHomeEntries,
  homeCategoryLabels,
  type HomeCategory,
} from "~/features/home/entries";
import AppSettingsMenu from "~/features/settings/AppSettingsMenu";
import TransferPanel from "~/features/transfers/TransferPanel";
import { useSessionsStore } from "~/store/sessions";
import { useSettingsStore } from "~/store/settings";
import { useTransfersStore } from "~/store/transfers";
export default function HomePage() {
  const { t } = useLingui();
  const sessions = useSessionsStore((s) => s.sessions);
  const transfers = useTransfersStore((s) => s.transfers);
  const setLastTool = useSettingsStore((s) => s.setLastTool);
  const showGames = useSettingsStore((s) => s.showGames);
  const setShowGames = useSettingsStore((s) => s.setShowGames);
  const [activeTab, setActiveTab] = useState<HomeCategory>("tools");
  const lastTapAt = useRef(0);

  // 小游戏标签默认隐藏；⌘/Ctrl+. 切换它（桌面端），
  // 双击 MFTP 标题同样可切换（移动端）。
  const toggleGames = () => {
    const next = !showGames;
    setShowGames(next);
    setActiveTab(next ? "games" : "tools");
  };
  // 快捷键监听只在挂载时注册；通过 effect event
  // 读取最新的 toggleGames（它与双击处理器共享）。
  const toggleGamesOnKey = useEffectEvent(toggleGames);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ".") {
        event.preventDefault();
        toggleGamesOnKey();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const handleTitleTap = () => {
    const now = performance.now();
    if (now - lastTapAt.current < 300) {
      lastTapAt.current = 0;
      toggleGames();
    } else {
      lastTapAt.current = now;
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
  const categories = [
    ...new Set(availableHomeEntries.map((entry) => entry.category)),
  ] as HomeCategory[];
  return (
    <main className="bg-background text-foreground h-full overflow-auto">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-2.5 px-2.5 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
        <header className="border-border flex items-center justify-between gap-2 border-b pb-2">
          <div
            className="flex min-w-0 items-center gap-2"
            title={t`双击或按 ⌘/Ctrl + . 显示或隐藏小游戏`}
            onPointerDown={handleTitleTap}
          >
            <div className="border-border bg-card flex size-8 items-center justify-center rounded-md border">
              <Home className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">MFTP</h1>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
            <Badge variant={hasActivity ? "secondary" : "outline"}>
              <Activity data-icon="inline-start" />
              {hasActivity ? <Trans>活动中</Trans> : <Trans>空闲</Trans>}
            </Badge>
            <Badge variant="outline">
              <Plural
                value={{
                  activeSessionCount: activeSessions.length,
                }}
                one="# 连接"
                other="# 连接"
              />
            </Badge>
            <Badge variant="outline">
              <Plural
                value={{
                  runningTransferCount: runningTransfers.length,
                }}
                one="# 传输"
                other="# 传输"
              />
            </Badge>
            {failedTransfers.length > 0 ? (
              <Badge variant="destructive">
                <Plural
                  value={{
                    failedTransferCount: failedTransfers.length,
                  }}
                  one="# 失败"
                  other="# 失败"
                />
              </Badge>
            ) : null}
            <Button variant="outline" size="sm" asChild>
              <Link to="/logs" preload="intent">
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
                              className="group border-border bg-card hover:bg-accent hover:text-accent-foreground flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left"
                            >
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span className="border-border bg-background group-hover:bg-background flex size-8 shrink-0 items-center justify-center rounded-md border">
                                  <Icon className="size-4" />
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold">
                                    {entry.title}
                                  </span>
                                </span>
                              </div>
                              <ArrowRight className="text-muted-foreground group-hover:text-accent-foreground size-4 shrink-0" />
                            </Link>
                          );
                        })}
                    </div>
                  </TabsContent>
                ))}
              </>
            );
          })()}

          {/* 占位撑开，把传输列表推到视口底部。 */}
          <div className="flex-1" />

          <TransferPanel />
        </Tabs>
      </div>
    </main>
  );
}
