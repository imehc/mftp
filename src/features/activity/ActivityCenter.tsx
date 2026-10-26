import { Trans, useLingui } from "@lingui/react/macro";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import ExecutionLogToolbar from "~/features/connection-diagnostics/ExecutionLogToolbar";
import { logSource } from "~/features/logs/log-source";
import LogFilters from "~/features/logs/LogFilters";
import type { ActivityLogsController } from "~/features/logs/use-activity-logs";
import { UpdaterActivity } from "~/features/updater/integration";

import {
  type ActivityTab,
  type LogFilter,
  useActivityViewStore,
} from "./activity-view-store";
import { useActivityExecutionLogs } from "./ActivityProvider";
import ExecutionLogActivity from "./ExecutionLogActivity";
import PoetrySyncActivity from "./PoetrySyncActivity";
import TransferActivity from "./TransferActivity";
import TransferActivityToolbar from "./TransferActivityToolbar";

export function ActivityCenter({
  tab,
  onTabChange,
  history,
}: {
  tab: ActivityTab;
  onTabChange: (tab: ActivityTab) => void;
  history: ActivityLogsController;
}) {
  const { t } = useLingui();
  const logs = useActivityExecutionLogs();
  const view = useActivityViewStore();
  const sourceLabels = { ...history.sourceLabels };
  for (const operation of [...logs.operations, ...history.logs]) {
    if (!(operation.source in sourceLabels))
      sourceLabels[operation.source] = logSource(operation.source, t);
  }
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value as ActivityTab)}
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <div
        data-activity-toolbar
        className="flex shrink-0 flex-wrap items-center gap-2 md:gap-4"
      >
        <TabsList variant="line" density="adaptive" className="shrink-0">
          <TabsTrigger value="tasks">
            <Trans>任务</Trans>
          </TabsTrigger>
          <TabsTrigger value="logs">
            <Trans comment="活动中心页签，统一展示历史操作摘要与当前执行详情">
              日志
            </Trans>
          </TabsTrigger>
        </TabsList>
        {tab === "tasks" ? (
          <TransferActivityToolbar />
        ) : (
          <ExecutionLogToolbar logs={logs} />
        )}
      </div>
      <TabsContent
        value="tasks"
        className="group/activity-tasks flex min-h-0 flex-1 flex-col gap-3"
      >
        <UpdaterActivity />
        <PoetrySyncActivity />
        <TransferActivity />
      </TabsContent>
      <TabsContent value="logs" className="flex min-h-0 flex-1 flex-col gap-2">
        <LogFilters
          controller={{
            ...history,
            sourceLabels,
            resultLabels: {
              ...history.resultLabels,
              canceled: t({
                comment: "统一日志结果筛选，包含主动取消和执行中断",
                message: "已取消 / 中断",
              }),
              running: t`执行中`,
              unverified: t`未验证`,
            },
            query: view.query,
            setQuery: view.setLogQuery,
            source: view.source,
            setSource: view.setLogSource,
            result: view.filter,
            setResult: (value) => view.setFilter(value as LogFilter),
            range: view.range,
            setRange: view.setLogRange,
          }}
        />
        <ExecutionLogActivity history={history} />
      </TabsContent>
    </Tabs>
  );
}
