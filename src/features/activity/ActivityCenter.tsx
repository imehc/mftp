import { Trans } from "@lingui/react/macro";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import ExecutionLogToolbar from "~/features/connection-diagnostics/ExecutionLogToolbar";
import { UpdaterActivity } from "~/features/updater/integration";

import type { ActivityTab } from "./activity-view-store";
import { useActivityExecutionLogs } from "./ActivityProvider";
import ExecutionLogActivity from "./ExecutionLogActivity";
import PoetrySyncActivity from "./PoetrySyncActivity";
import TransferActivity from "./TransferActivity";
import TransferActivityToolbar from "./TransferActivityToolbar";

export function ActivityCenter({
  tab,
  onTabChange,
}: {
  tab: ActivityTab;
  onTabChange: (tab: ActivityTab) => void;
}) {
  const logs = useActivityExecutionLogs();
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
            <Trans comment="活动中心页签，展示当前运行期的日志而非持久历史">
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
      <TabsContent value="logs" className="flex min-h-0 flex-1 flex-col">
        <ExecutionLogActivity />
      </TabsContent>
    </Tabs>
  );
}
