import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowDown, ChevronDown } from "lucide-react";
import { Collapsible } from "radix-ui";
import { useLayoutEffect, useRef, useState } from "react";

import type { DiagnosticOperation } from "~/bindings";
import { Button } from "~/components/ui/button";
import { describeError } from "~/lib/errors";

import ExecutionLogDetails from "./ExecutionLogDetails";
import ExecutionLogLine from "./ExecutionLogLine";
import ExecutionLogProgress from "./ExecutionLogProgress";
import type { ExecutionLogs } from "./use-execution-logs";

export default function ExecutionLogList({
  logs,
  label,
}: {
  logs: ExecutionLogs;
  label: (operation: DiagnosticOperation) => string;
}) {
  const { t } = useLingui();
  const scroll = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  useLayoutEffect(() => {
    // 只在用户仍跟随最新记录时滚到底部；查看历史不被异步结果打断。
    const element = scroll.current;
    if (!following || !element) return;

    const follow = () => {
      element.scrollTop = element.scrollHeight;
    };

    follow();
    // Popover 定位后才确定可用高度，初次布局的滚动值可能被后续测量重置。
    const resize = new ResizeObserver(follow);
    resize.observe(element);
    return () => resize.disconnect();
  }, [logs.operations, following]);
  return (
    <>
      <div
        ref={scroll}
        role="region"
        aria-label={t`执行日志记录`}
        tabIndex={0}
        className="focus-visible:ring-ring flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-1 outline-none focus-visible:ring-2"
        onScroll={(event) => {
          const element = event.currentTarget;
          setFollowing(
            element.scrollHeight - element.scrollTop - element.clientHeight <
              24,
          );
        }}
      >
        {logs.error ? (
          <p className="text-destructive text-sm">
            {describeError(logs.error, t)}
          </p>
        ) : null}
        {logs.discarded ? (
          <p className="text-muted-foreground text-xs">
            <Trans>部分操作因记录上限未保留，最多显示 20 次操作。</Trans>
          </p>
        ) : null}
        {logs.operations.map((entry) => {
          const correlationId = entry.correlationId;
          return (
            <article
              key={entry.id}
              className="flex shrink-0 flex-col gap-2 rounded-xl border p-3"
            >
              <h3 className="text-sm font-medium">
                <ExecutionLogLine operation={entry} label={label(entry)} />
              </h3>
              <p className="text-muted-foreground text-xs break-all">
                {entry.id}
              </p>
              {entry.correlationId ? (
                <p className="text-muted-foreground text-xs break-all">
                  <Trans comment="连接日志中关联传输任务的 ID，不代表任务已完成">
                    关联传输：{correlationId}
                  </Trans>
                </p>
              ) : null}
              {entry.discardedDetails > 0 ? (
                <p className="text-muted-foreground text-xs">
                  <Trans>部分命令详情超出记录上限。</Trans>
                </p>
              ) : null}
              {entry.metadataTruncated || entry.redacted ? (
                <p className="text-muted-foreground text-xs">
                  {entry.metadataTruncated ? (
                    <Trans>操作信息已截断</Trans>
                  ) : null}
                  {entry.metadataTruncated && entry.redacted ? " · " : null}
                  {entry.redacted ? <Trans>凭据已脱敏</Trans> : null}
                </p>
              ) : null}
              {entry.progress ? (
                <ExecutionLogProgress progress={entry.progress} />
              ) : null}
              {entry.error ? (
                <p className="text-destructive text-sm">
                  {describeError(entry.error, t)}
                </p>
              ) : null}
              <Collapsible.Root className="flex min-w-0 flex-col gap-2">
                <Collapsible.Trigger asChild>
                  <Button
                    density="adaptive"
                    variant="ghost"
                    size="sm"
                    className="w-fit"
                  >
                    <ChevronDown data-icon="inline-start" aria-hidden="true" />
                    <Trans>执行详情</Trans>
                  </Button>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <ExecutionLogDetails
                    details={entry.details}
                    trace={entry.trace}
                  />
                </Collapsible.Content>
              </Collapsible.Root>
            </article>
          );
        })}
      </div>
      {!following ? (
        <Button
          density="adaptive"
          size="sm"
          variant="outline"
          className="self-center"
          onClick={() => setFollowing(true)}
        >
          <ArrowDown data-icon="inline-start" aria-hidden="true" />
          <Trans>查看最新记录</Trans>
        </Button>
      ) : null}
    </>
  );
}
