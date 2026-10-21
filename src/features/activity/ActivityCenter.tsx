import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { FileClock, ListTodo, Logs } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { UpdaterActivity } from "~/features/updater/integration";

import ExecutionLogActivity from "./ExecutionLogActivity";
import PoetrySyncActivity from "./PoetrySyncActivity";
import TransferActivity from "./TransferActivity";

export type ActivityTab = "tasks" | "logs";

export function ActivityCenter({
  mode,
  tab,
  onTabChange,
  onNavigate,
  onClose,
}: {
  mode: "panel" | "page";
  tab: ActivityTab;
  onTabChange: (tab: ActivityTab) => void;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value as ActivityTab)}
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <TabsList density="adaptive" className="w-full shrink-0">
        <TabsTrigger value="tasks">
          <ListTodo data-icon="inline-start" aria-hidden />
          <Trans>任务</Trans>
        </TabsTrigger>
        <TabsTrigger value="logs">
          <Logs data-icon="inline-start" aria-hidden />
          <Trans>执行日志</Trans>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="tasks" className="flex min-h-0 flex-1 flex-col gap-3">
        <UpdaterActivity />
        <PoetrySyncActivity />
        <TransferActivity />
      </TabsContent>
      <TabsContent value="logs" className="flex min-h-0 flex-1 flex-col">
        <ExecutionLogActivity />
      </TabsContent>
      <div className="flex shrink-0 flex-col gap-2 border-t pt-3">
        {tab === "tasks" ? (
          <p className="text-muted-foreground text-xs">
            {mode === "panel" ? (
              <Trans>
                关闭活动面板会丢弃本次执行日志，但不会取消正在运行的任务。
              </Trans>
            ) : (
              <Trans>
                离开活动页会丢弃本次执行日志，但不会取消正在运行的任务。
              </Trans>
            )}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="flex-1">
            <Link to="/logs" onClick={onNavigate}>
              <FileClock data-icon="inline-start" aria-hidden />
              <Trans>查看活动日志</Trans>
            </Link>
          </Button>
          {onClose ? (
            <Button variant="outline" className="flex-1" onClick={onClose}>
              <Trans>关闭</Trans>
            </Button>
          ) : null}
        </div>
      </div>
    </Tabs>
  );
}
