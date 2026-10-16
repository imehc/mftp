import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDown, ChevronUp, Logs, X } from "lucide-react";
import { useId, useState } from "react";

import type { DiagnosticOperation } from "~/bindings";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Spinner } from "~/components/ui/spinner";
import { logAction } from "~/features/logs/log-labels";
import { diagnosticsClear } from "~/lib/ipc";

import ExecutionLogLine from "./ExecutionLogLine";
import ExecutionLogList from "./ExecutionLogList";
import { useExecutionLogs } from "./use-execution-logs";

function label(operation: DiagnosticOperation) {
  return `${logAction({ source: operation.source, requestType: operation.action })} · ${operation.target}`;
}

/**
 * 应用级外部服务活动面板。默认只显示当前操作的一行状态，点击向上展开详情。
 * 空闲时整条隐藏；关闭面板即丢弃后端内存中的记录，不落盘也不导出。
 */
export default function ExecutionLogDock() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const logs = useExecutionLogs();
  const latest = logs.operations.at(-1);
  if (!latest && !logs.error) return null;
  return (
    <footer
      className="bg-background shrink-0 border-t pb-(--safe-bottom)"
      data-testid="execution-log-dock"
    >
      <div className="app-page-width mx-auto w-full px-3 py-1 md:px-4">
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            // 关闭查看器即丢弃这批记录；后端不会为已关闭的面板保留历史。
            if (!next) {
              logs.clear();
              void diagnosticsClear().catch(() => {});
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              density="adaptive"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              aria-label={open ? t`收起执行日志` : t`展开执行日志`}
            >
              {latest?.status === "running" ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Logs data-icon="inline-start" aria-hidden="true" />
              )}
              <span role="status" className="min-w-0 flex-1 text-left">
                {latest ? (
                  <ExecutionLogLine
                    operation={latest}
                    label={label(latest)}
                    compact
                  />
                ) : (
                  <span className="block truncate">
                    <Trans>执行日志暂不可用</Trans>
                  </span>
                )}
              </span>
              {open ? (
                <ChevronDown data-icon="inline-end" aria-hidden="true" />
              ) : (
                <ChevronUp data-icon="inline-end" aria-hidden="true" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="center"
            collisionPadding={12}
            aria-labelledby={titleId}
            className="ui-density-adaptive max-h-[min(40dvh,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) overflow-hidden [@media(max-height:30rem)]:max-h-[min(70dvh,var(--radix-popover-content-available-height))]"
          >
            <PopoverHeader className="shrink-0">
              <div className="flex items-center justify-between gap-2">
                <PopoverTitle id={titleId}>
                  <Trans>执行日志</Trans>
                </PopoverTitle>
                <Button
                  density="adaptive"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t`收起执行日志`}
                  onClick={() => setOpen(false)}
                >
                  <X />
                </Button>
              </div>
            </PopoverHeader>
            <ExecutionLogList logs={logs} label={label} />
          </PopoverContent>
        </Popover>
      </div>
    </footer>
  );
}
