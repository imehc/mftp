import { useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronRight } from "lucide-react";

import type { DiagnosticOperation } from "~/bindings";
import { useActivityViewStore } from "~/features/activity/activity-view-store";
import { logAction } from "~/features/logs/log-labels";
import { logSource } from "~/features/logs/log-source";
import { TOUCH_TARGET_CLASS } from "~/lib/touch";

import { hasExecutionLogContent } from "./execution-log-content";
import { EXECUTION_LOG_COLUMNS } from "./execution-log-layout";
import ExecutionLogStatus from "./ExecutionLogStatus";

export default function ExecutionLogRow({
  operation,
}: {
  operation: DiagnosticOperation;
}) {
  const { t, i18n } = useLingui();
  const action = logAction(
    { source: operation.source, requestType: operation.action },
    (message) => i18n._(message),
  );
  const time = i18n.date(operation.startedAt, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const hasContent = hasExecutionLogContent(operation);
  const content = (
    <>
      <time className="text-muted-foreground hidden text-xs tabular-nums md:block">
        {time}
      </time>
      <span className="text-muted-foreground hidden truncate text-xs md:block">
        {logSource(operation.source, (message) => i18n._(message))}
      </span>
      <span className="min-w-0 truncate text-sm font-medium">{action}</span>
      <span className="text-muted-foreground hidden min-w-0 truncate text-sm md:block">
        {operation.target}
      </span>
      <span className="col-start-2 row-start-1 flex items-center justify-end gap-2 md:col-start-auto md:row-auto">
        <ExecutionLogStatus operation={operation} />
        {hasContent ? (
          <ChevronRight
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden
          />
        ) : (
          <span className="hidden size-3.5 md:block" />
        )}
      </span>
      <span className="text-muted-foreground col-span-2 row-start-2 flex min-w-0 items-center gap-2 text-xs md:hidden">
        <span className="min-w-0 flex-1 truncate">{operation.target}</span>
        <time className="shrink-0 tabular-nums">{time}</time>
        <span className="max-w-16 truncate">
          {logSource(operation.source, (message) => i18n._(message))}
        </span>
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
      search={{ tab: "logs", operation: operation.id }}
      state={{ activityLogDetail: true }}
      aria-label={t({
        comment: "运行期日志列表行，进入该操作的实际详情",
        message: `查看日志：${action}`,
      })}
      className={cn(
        className,
        "hover:bg-muted/40 focus-visible:ring-ring outline-none focus-visible:ring-2",
      )}
      data-log-row
      data-log-detail
      data-operation={operation.id}
      onClick={() =>
        useActivityViewStore.getState().focusOperation(operation.id)
      }
    >
      {content}
    </Link>
  ) : (
    <div className={className} data-log-row>
      {content}
    </div>
  );
}
