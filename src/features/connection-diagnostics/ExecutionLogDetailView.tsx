import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowLeft, Copy, Ellipsis } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import type { AppError, DiagnosticOperation } from "~/bindings";
import AppPageContent from "~/components/AppPageContent";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { logAction } from "~/features/logs/log-labels";
import { logSource } from "~/features/logs/log-source";
import { describeError, toIpcError } from "~/lib/errors";

import {
  executionLogStream,
  executionLogStreamText,
} from "./execution-log-stream";
import ExecutionLogDetails from "./ExecutionLogDetails";
import ExecutionLogMetadata from "./ExecutionLogMetadata";
import ExecutionLogStatus from "./ExecutionLogStatus";

export default function ExecutionLogDetailView({
  operation,
  onBack,
}: {
  operation: DiagnosticOperation;
  onBack: () => void;
}) {
  const { t, i18n } = useLingui();
  const [metadata, setMetadata] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<AppError | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const blocks = executionLogStream(operation, { localize: t });
  useLayoutEffect(() => {
    scroll.current?.focus();
  }, [operation.id]);

  async function copy() {
    if (copying) return;
    setCopying(true);
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(executionLogStreamText(blocks));
    } catch (cause) {
      setCopyError(toIpcError(cause).payload);
    } finally {
      setCopying(false);
    }
  }

  return (
    <>
      <ToolPageHeader
        showHome={false}
        showActivity={false}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">
              {logAction(
                { source: operation.source, requestType: operation.action },
                (message) => i18n._(message),
              )}
            </span>
            <ExecutionLogStatus
              operation={operation}
              showResponseCode={false}
            />
          </span>
        }
        description={<span title={operation.target}>{operation.target}</span>}
        leading={
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            aria-label={t({
              comment: "单条日志详情返回摘要列表",
              message: "返回日志列表",
            })}
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
                aria-label={t({
                  comment: "单条日志详情的复制与元信息菜单",
                  message: "日志详情操作",
                })}
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="ui-density-adaptive">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  disabled={copying}
                  onSelect={() => void copy()}
                >
                  <Copy />
                  <Trans comment="复制已脱敏的当前操作与实际日志内容">
                    复制日志
                  </Trans>
                </DropdownMenuItem>
                <DropdownMenuCheckboxItem
                  checked={metadata}
                  onCheckedChange={setMetadata}
                >
                  <Trans comment="日志详情菜单，按需显示操作ID和统计">
                    元信息
                  </Trans>
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
          className="text-muted-foreground flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
          data-log-context
        >
          <span>
            {logSource(operation.source, (message) => i18n._(message))}
          </span>
          <time
            className="tabular-nums"
            dateTime={new Date(operation.startedAt).toISOString()}
          >
            {i18n.date(operation.startedAt, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            })}
          </time>
          {operation.redacted ? (
            <span>
              <Trans>凭据已脱敏</Trans>
            </span>
          ) : null}
          {operation.metadataTruncated || operation.discardedDetails > 0 ? (
            <span>
              <Trans comment="当前操作的部分详情超过内存容量，原文并不完整">
                部分内容已截断
              </Trans>
            </span>
          ) : null}
        </div>
        {copyError ? (
          <p role="alert" className="text-destructive text-sm">
            {describeError(copyError, t)}
          </p>
        ) : null}
        <div
          ref={scroll}
          className="app-scroll-safe-end min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
          role="region"
          aria-label={t({
            comment: "单条日志详情的无障碍名称",
            message: "日志详情",
          })}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onBack();
            }
          }}
        >
          <ExecutionLogDetails blocks={blocks} />
          {metadata ? (
            <dl className="text-muted-foreground mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-t pt-3 text-xs">
              <dt>
                <Trans>对象</Trans>
              </dt>
              <dd className="break-all">{operation.target}</dd>
              <dt>
                <Trans comment="日志元信息中的诊断操作标识">操作 ID</Trans>
              </dt>
              <dd className="break-all">{operation.id}</dd>
              {operation.correlationId ? (
                <>
                  <dt>
                    <Trans comment="日志元信息中关联传输任务的标识">
                      关联 ID
                    </Trans>
                  </dt>
                  <dd className="break-all">{operation.correlationId}</dd>
                </>
              ) : null}
              <dt>
                <Trans comment="当前日志操作的执行时长">耗时</Trans>
              </dt>
              <dd className="tabular-nums">
                {i18n.number(operation.elapsedMs)} ms
              </dd>
              <ExecutionLogMetadata operation={operation} />
            </dl>
          ) : null}
        </div>
      </AppPageContent>
    </>
  );
}
