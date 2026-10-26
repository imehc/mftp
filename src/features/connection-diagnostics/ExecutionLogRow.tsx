import { useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronRight } from "lucide-react";

import { useActivityViewStore } from "~/features/activity/activity-view-store";
import { logSource } from "~/features/logs/log-source";
import { LogResult } from "~/features/logs/LogResult";
import {
  logSourceCode,
  logTime,
  type UnifiedLog,
  unifiedLogAction,
  unifiedLogObject,
} from "~/features/logs/unified-logs";
import { TOUCH_TARGET_CLASS } from "~/lib/touch";

import { hasExecutionLogContent } from "./execution-log-content";
import { EXECUTION_LOG_COLUMNS } from "./execution-log-layout";
import ExecutionLogStatus from "./ExecutionLogStatus";

export default function ExecutionLogRow({
  entry,
  sourceLabels,
  resultLabels,
}: {
  entry: UnifiedLog;
  sourceLabels: Record<string, string>;
  resultLabels: Record<string, string>;
}) {
  const { t, i18n } = useLingui();
  const { operation, history } = entry;
  const action = unifiedLogAction(entry, t);
  const object = unifiedLogObject(entry, t);
  const source = logSourceCode(entry);
  const sourceLabel = sourceLabels[source] ?? logSource(source, t);
  const time = i18n.date(logTime(entry), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const hasContent =
    !!history || (operation && hasExecutionLogContent(operation));
  const content = (
    <>
      <time className="text-muted-foreground hidden text-xs tabular-nums lg:block">
        {time}
      </time>
      <span className="text-muted-foreground hidden truncate text-xs lg:block">
        {sourceLabel}
      </span>
      <span className="min-w-0 truncate text-sm font-medium">{action}</span>
      <span className="text-muted-foreground hidden min-w-0 truncate text-sm lg:block">
        {object}
      </span>
      <span className="col-start-2 row-start-1 flex items-center justify-end gap-2 lg:col-start-auto lg:row-auto">
        {operation ? (
          <ExecutionLogStatus operation={operation} />
        ) : (
          <LogResult log={history!} labels={resultLabels} />
        )}
        {hasContent ? (
          <ChevronRight
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden
          />
        ) : (
          <span className="hidden size-3.5 lg:block" />
        )}
      </span>
      <span className="text-muted-foreground col-span-2 row-start-2 flex min-w-0 items-center gap-2 text-xs lg:hidden">
        <span className="min-w-0 flex-1 truncate">{object}</span>
        <time className="shrink-0 tabular-nums">{time}</time>
        <span className="max-w-16 truncate">{sourceLabel}</span>
      </span>
    </>
  );
  const className = cn(
    "grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b py-3 text-left",
    EXECUTION_LOG_COLUMNS,
    TOUCH_TARGET_CLASS,
  );
  return hasContent ? (
    <Link
      to="/activity"
      search={{
        tab: "logs",
        operation: history?.operationId ?? operation?.id,
        history: history?.id,
      }}
      state={{ activityLogDetail: true }}
      aria-label={t({
        comment: "统一日志列表行，进入操作摘要及仍可用的执行详情",
        message: `查看日志：${action}`,
      })}
      className={cn(
        className,
        "hover:bg-muted/40 focus-visible:ring-ring outline-none focus-visible:ring-2",
      )}
      data-log-row
      data-log-detail
      data-operation={entry.id}
      onClick={() => useActivityViewStore.getState().focusOperation(entry.id)}
    >
      {content}
    </Link>
  ) : (
    <div className={className} data-log-row data-operation={entry.id}>
      {content}
    </div>
  );
}
