import { useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { ChevronRight } from "lucide-react";

import { TOUCH_TARGET_CLASS } from "~/lib/touch";
import type { ActivityLog } from "~/types";

import { logAction, logObject } from "./log-labels";
import { hasLogDetail } from "./log-utils";
import { LogResult } from "./LogResult";
import type { ActivityLogsController } from "./use-activity-logs";

export const LOG_COLUMNS =
  "md:grid-cols-[8rem_4rem_minmax(0,1fr)_minmax(0,1.5fr)_7.5rem]";

export default function LogRow({
  log,
  controller,
}: {
  log: ActivityLog;
  controller: ActivityLogsController;
}) {
  const { t, i18n } = useLingui();
  const action = logAction(log, t);
  const object = logObject(log, t);
  const time = i18n.date(log.createdAt, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const hasContent = hasLogDetail(log);
  const className = cn(
    "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b px-3 py-3 text-left md:px-4",
    LOG_COLUMNS,
    TOUCH_TARGET_CLASS,
  );
  const content = (
    <>
      <time
        dateTime={new Date(log.createdAt).toISOString()}
        className="text-muted-foreground hidden text-xs tabular-nums md:block"
      >
        {time}
      </time>
      <span className="text-muted-foreground hidden truncate text-xs md:block">
        {controller.sourceLabels[log.source] ?? log.source}
      </span>
      <span className="min-w-0 truncate text-sm font-medium" title={action}>
        {action}
      </span>
      <span
        className="text-muted-foreground hidden min-w-0 truncate text-sm md:block"
        title={object}
      >
        {object}
      </span>
      <span className="col-start-2 row-start-1 flex items-center justify-end gap-2 md:col-start-auto md:row-auto">
        <LogResult log={log} labels={controller.resultLabels} />
        {hasContent ? (
          <ChevronRight
            aria-hidden
            className="text-muted-foreground size-3.5 shrink-0"
          />
        ) : (
          <span className="hidden size-3.5 md:block" />
        )}
      </span>
      <span className="text-muted-foreground col-span-2 row-start-2 flex min-w-0 items-center gap-2 text-xs md:hidden">
        <span className="min-w-0 flex-1 truncate" title={object}>
          {object}
        </span>
        <time
          dateTime={new Date(log.createdAt).toISOString()}
          className="shrink-0 tabular-nums"
        >
          {time}
        </time>
        <span className="max-w-16 truncate">
          {controller.sourceLabels[log.source] ?? log.source}
        </span>
      </span>
    </>
  );
  return hasContent ? (
    <button
      type="button"
      onClick={() => controller.setSelected(log)}
      aria-label={t({
        comment: "历史日志行：只有实际摘要正文或应用错误才打开详情",
        message: `查看日志：${action}`,
      })}
      className={cn(
        className,
        "hover:bg-muted/40 focus-visible:ring-ring outline-none focus-visible:ring-2",
      )}
      data-history-log-row
      data-history-log-detail
    >
      {content}
    </button>
  ) : (
    <div className={className} data-history-log-row>
      {content}
    </div>
  );
}
