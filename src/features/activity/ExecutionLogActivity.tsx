import { Trans } from "@lingui/react/macro";
import { Logs } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { executionLogLabel } from "~/features/connection-diagnostics/execution-log-label";
import ExecutionLogLine from "~/features/connection-diagnostics/ExecutionLogLine";
import ExecutionLogList from "~/features/connection-diagnostics/ExecutionLogList";

import { useActivityExecutionLogs } from "./ActivityProvider";

/** 活动中心的实时执行日志页签；关闭面板或离开活动页时丢弃本次记录。 */
export default function ExecutionLogActivity() {
  const logs = useActivityExecutionLogs();
  const latest = logs.operations.at(-1);
  if (!logs.operations.length && !logs.error) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Logs />
          </EmptyMedia>
          <EmptyTitle>
            <Trans>暂无执行记录</Trans>
          </EmptyTitle>
          <EmptyDescription>
            <Trans>与外部服务交互后，可以在这里查看实时执行日志。</Trans>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2 text-xs">
        {latest?.status === "running" ? (
          <Spinner
            aria-hidden
            className="size-3.5 motion-reduce:animate-none"
          />
        ) : (
          <Logs aria-hidden className="text-muted-foreground size-3.5" />
        )}
        <div className="min-w-0 flex-1">
          {latest ? (
            <ExecutionLogLine
              operation={latest}
              label={executionLogLabel(latest)}
              compact
            />
          ) : (
            <span className="text-muted-foreground">
              <Trans>执行日志暂不可用</Trans>
            </span>
          )}
        </div>
        {logs.operations.length ? (
          <Badge variant="secondary">{logs.operations.length}</Badge>
        ) : null}
      </div>
      <ExecutionLogList logs={logs} label={executionLogLabel} />
    </div>
  );
}
