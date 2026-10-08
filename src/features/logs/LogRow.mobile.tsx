import { Trans, useLingui } from "@lingui/react/macro";

import { Button } from "~/components/ui/button";
import type { ActivityLog } from "~/types";

import { logAction, logObject } from "./log-labels";
import { logDetail } from "./log-utils";
import { LogResult } from "./LogResult";
import type { ActivityLogsController } from "./use-activity-logs";

export default function LogRowMobile({
  log,
  controller: c,
}: {
  log: ActivityLog;
  controller: ActivityLogsController;
}) {
  const { i18n } = useLingui();
  const detail = logDetail(log);
  return (
    <article className="flex flex-col gap-1 border-b py-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-sm font-medium break-words">
          {logAction(log)}
        </h2>
        <LogResult log={log} labels={c.resultLabels} />
      </div>
      <p className="text-sm break-all">{logObject(log)}</p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground min-w-0 text-xs break-words tabular-nums">
          {c.sourceLabels[log.source] ?? log.source} ·{" "}
          {new Date(log.createdAt).toLocaleString(i18n.locale)}
        </p>
        <Button
          variant="ghost"
          size="sm"
          density="adaptive"
          onClick={() => c.setSelected(log)}
        >
          <Trans>详情</Trans>
        </Button>
      </div>
      {detail ? (
        <p className="text-muted-foreground line-clamp-2 text-xs break-words">
          {detail}
        </p>
      ) : null}
    </article>
  );
}
