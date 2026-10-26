import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowLeft, Ellipsis } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import AppPageContent from "~/components/AppPageContent";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { ExecutionLogs } from "~/features/connection-diagnostics/use-execution-logs";
import { describeError } from "~/lib/errors";
import type { ActivityLog } from "~/types";

import { logAction, logObject } from "./log-labels";
import { logDetail } from "./log-utils";
import { LogResult } from "./LogResult";
import type { ActivityLogsController } from "./use-activity-logs";

export default function HistoryLogDetailView({
  log,
  controller,
  execution,
  onBack,
}: {
  log: ActivityLog;
  controller: ActivityLogsController;
  execution: ExecutionLogs;
  onBack: () => void;
}) {
  const { t, i18n } = useLingui();
  const scroll = useRef<HTMLDivElement>(null);
  const [metadata, setMetadata] = useState(false);
  useLayoutEffect(() => {
    scroll.current?.focus();
  }, [log.id]);
  const detail = logDetail(log, t);
  return (
    <>
      <ToolPageHeader
        showHome={false}
        showActivity={false}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{logAction(log, t)}</span>
            <LogResult log={log} labels={controller.resultLabels} />
          </span>
        }
        description={logObject(log, t)}
        leading={
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            aria-label={t`返回日志列表`}
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
        }
        trailing={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                density="adaptive"
                aria-label={t`日志详情操作`}
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="ui-density-adaptive">
              <DropdownMenuGroup>
                <DropdownMenuCheckboxItem
                  checked={metadata}
                  onCheckedChange={setMetadata}
                >
                  <Trans>元信息</Trans>
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <AppPageContent
        width="full"
        scroll="content"
        density="compact"
        bottomInset="scroll"
      >
        <div
          data-log-context
          className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs"
        >
          <span>{controller.sourceLabels[log.source] ?? log.source}</span>
          <time dateTime={new Date(log.createdAt).toISOString()}>
            {i18n.date(log.createdAt, {
              dateStyle: "short",
              timeStyle: "medium",
            })}
          </time>
        </div>
        <div
          ref={scroll}
          role="region"
          aria-label={t`日志详情`}
          tabIndex={0}
          className="app-scroll-safe-end min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onBack();
            }
          }}
        >
          {detail ? (
            <p className="text-sm wrap-break-word whitespace-pre-wrap">
              {detail}
            </p>
          ) : null}
          {log.operationId ? (
            execution.loading ? (
              <p role="status" className="text-muted-foreground mt-3 text-sm">
                <Trans>正在读取执行详情…</Trans>
              </p>
            ) : execution.error ? (
              <p role="alert" className="text-destructive mt-3 text-sm">
                <Trans>读取执行详情失败</Trans> ·{" "}
                {describeError(execution.error, t)}
              </p>
            ) : (
              <p className="text-muted-foreground mt-3 text-sm">
                <Trans>当前未保留执行详情，历史摘要仍可查看。</Trans>
              </p>
            )
          ) : !detail ? (
            <p className="text-muted-foreground text-sm">
              <Trans>此操作仅保留摘要。</Trans>
            </p>
          ) : null}
          {metadata ? (
            <dl className="text-muted-foreground mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-t pt-3 text-xs">
              <dt>
                <Trans comment="历史摘要元信息中的原始操作代码">操作标识</Trans>
              </dt>
              <dd className="break-all">{log.requestType}</dd>
              <dt>
                <Trans comment="历史摘要元信息中未经展示格式化的操作对象">
                  对象原值
                </Trans>
              </dt>
              <dd className="break-all">{log.ip || "—"}</dd>
              {log.operationId ? (
                <>
                  <dt>
                    <Trans comment="历史摘要关联的内存执行记录标识">
                      执行记录 ID
                    </Trans>
                  </dt>
                  <dd className="break-all">{log.operationId}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
        </div>
      </AppPageContent>
    </>
  );
}
