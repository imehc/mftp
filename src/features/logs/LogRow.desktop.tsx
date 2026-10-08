import { Trans, useLingui } from "@lingui/react/macro";

import type { ActivityLog } from "~/types";

import { logAction, logObject } from "./log-labels";
import { logDetail } from "./log-utils";
import { LogResult } from "./LogResult";
import type { ActivityLogsController } from "./use-activity-logs";

export const LOG_COLUMNS =
  "grid-cols-[9rem_5rem_minmax(5rem,1fr)_minmax(6rem,1.2fr)_4.5rem_minmax(6rem,1.5fr)]";

export function LogTableHead() {
  return (
    <div
      className={`bg-muted/50 text-muted-foreground grid shrink-0 items-center gap-3 border-b px-4 py-2 text-xs ${LOG_COLUMNS}`}
      aria-hidden="true"
    >
      <span>
        <Trans>时间</Trans>
      </span>
      <span>
        <Trans>来源</Trans>
      </span>
      <span>
        <Trans>操作</Trans>
      </span>
      <span>
        <Trans>对象</Trans>
      </span>
      <span>
        <Trans>结果</Trans>
      </span>
      <span>
        <Trans>详情</Trans>
      </span>
    </div>
  );
}

export default function LogRowDesktop({
  log,
  controller: c,
}: {
  log: ActivityLog;
  controller: ActivityLogsController;
}) {
  const { t, i18n } = useLingui();
  const action = logAction(log);
  const object = logObject(log);
  return (
    <button
      type="button"
      onClick={() => c.setSelected(log)}
      aria-label={t({
        comment: "活动日志行：打开指定操作的详情",
        message: `查看日志：${action}`,
      })}
      className={`hover:bg-muted/50 focus-visible:bg-muted grid min-h-12 w-full items-center gap-3 border-b px-4 py-3 text-left text-sm ${LOG_COLUMNS}`}
    >
      <span className="text-muted-foreground text-xs tabular-nums">
        {new Date(log.createdAt).toLocaleString(i18n.locale)}
      </span>
      <span className="truncate text-xs">
        {c.sourceLabels[log.source] ?? log.source}
      </span>
      <span className="truncate" title={action}>
        {action}
      </span>
      <span className="truncate" title={object}>
        {object}
      </span>
      <LogResult log={log} labels={c.resultLabels} />
      <span className="text-muted-foreground truncate text-xs">
        {logDetail(log) || "—"}
      </span>
    </button>
  );
}
