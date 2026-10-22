import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { useLayoutEffect, useRef } from "react";

import { Button } from "~/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { useActivityViewStore } from "~/features/activity/activity-view-store";
import { describeError } from "~/lib/errors";

import { executionLogIsFailed } from "./execution-log-content";
import { EXECUTION_LOG_COLUMNS } from "./execution-log-layout";
import ExecutionLogRow from "./ExecutionLogRow";
import type { ExecutionLogs } from "./use-execution-logs";

export default function ExecutionLogList({ logs }: { logs: ExecutionLogs }) {
  const { t } = useLingui();
  const scroll = useRef<HTMLDivElement>(null);
  const filter = useActivityViewStore((state) => state.filter);
  const following = useActivityViewStore((state) => state.following);
  const saveScroll = useActivityViewStore((state) => state.saveScroll);
  const operations =
    filter === "failed"
      ? logs.operations.filter(executionLogIsFailed)
      : logs.operations;
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    element.scrollTop = useActivityViewStore.getState().scrollTop;
    const focusedOperation = useActivityViewStore.getState().focusedOperation;
    if (focusedOperation) {
      const row = Array.from(
        element.querySelectorAll<HTMLAnchorElement>("[data-operation]"),
      ).find((item) => item.dataset.operation === focusedOperation);
      (row ?? element).focus({ preventScroll: true });
    }
  }, [filter]);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element || !following) return;

    const follow = () => {
      element.scrollTop = element.scrollHeight;
    };

    follow();
    const resize = new ResizeObserver(follow);
    resize.observe(element);
    return () => resize.disconnect();
  }, [logs.operations, following]);
  return (
    <>
      {logs.error ? (
        <p role="alert" className="text-destructive text-sm break-words">
          {describeError(logs.error, t)}
        </p>
      ) : null}
      {logs.discarded ? (
        <p className="text-muted-foreground text-xs">
          <Trans comment="当前运行期日志达到容量上限时的短提示">
            仅保留最近记录
          </Trans>
        </p>
      ) : null}
      <div
        aria-hidden
        className={cn(
          "text-muted-foreground hidden shrink-0 gap-3 border-b pb-2 text-xs md:grid",
          EXECUTION_LOG_COLUMNS,
        )}
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
        <span className="min-w-24 text-right">
          <Trans>结果</Trans>
        </span>
      </div>
      <div
        ref={scroll}
        role="region"
        aria-label={t({
          comment: "运行期日志摘要列表的无障碍名称",
          message: "日志记录",
        })}
        tabIndex={0}
        className="app-scroll-safe-end focus-visible:ring-ring flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain outline-none focus-visible:ring-2"
        onScroll={(event) => {
          const element = event.currentTarget;
          saveScroll(
            element.scrollTop,
            element.scrollHeight - element.scrollTop - element.clientHeight <
              24,
          );
        }}
      >
        {logs.loading ? (
          <p
            role="status"
            className="text-muted-foreground py-8 text-center text-sm"
          >
            <Trans>加载中…</Trans>
          </p>
        ) : operations.length ? (
          operations.map((operation) => (
            <ExecutionLogRow key={operation.id} operation={operation} />
          ))
        ) : !logs.error ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyTitle>
                {filter === "failed" ? (
                  <Trans comment="日志只看失败筛选的空状态">没有失败记录</Trans>
                ) : (
                  <Trans comment="活动日志页签的空状态标题">暂无日志</Trans>
                )}
              </EmptyTitle>
            </EmptyHeader>
            {filter === "failed" ? (
              <Button
                variant="ghost"
                size="sm"
                density="adaptive"
                onClick={() => useActivityViewStore.getState().setFilter("all")}
              >
                <Trans comment="失败日志筛选无结果时恢复全部记录">
                  显示全部
                </Trans>
              </Button>
            ) : null}
          </Empty>
        ) : null}
      </div>
    </>
  );
}
