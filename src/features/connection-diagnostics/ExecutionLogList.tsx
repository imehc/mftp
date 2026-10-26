import { Trans, useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "cn";
import { useDeferredValue, useLayoutEffect, useRef } from "react";

import { Button } from "~/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { useActivityViewStore } from "~/features/activity/activity-view-store";
import { filterUnifiedLogs, mergeLogs } from "~/features/logs/unified-logs";
import type { ActivityLogsController } from "~/features/logs/use-activity-logs";
import { describeError } from "~/lib/errors";
import { useVirtualizerFontSize } from "~/lib/root-font-size";
import { useMediaQuery } from "~/lib/use-media-query";

import { EXECUTION_LOG_COLUMNS } from "./execution-log-layout";
import ExecutionLogRow from "./ExecutionLogRow";
import type { ExecutionLogs } from "./use-execution-logs";

export default function ExecutionLogList({
  logs,
  history,
}: {
  logs: ExecutionLogs;
  history: ActivityLogsController;
}) {
  const { t } = useLingui();
  const scroll = useRef<HTMLDivElement>(null);
  const view = useActivityViewStore();
  const wide = useMediaQuery("(min-width: 64rem)");
  const query = useDeferredValue(view.query);
  const ordered = filterUnifiedLogs(
    mergeLogs(history.logs, logs.operations),
    { ...view, query },
    { ...history.sourceLabels, ...history.resultLabels },
    t,
  );
  const virtualizer = useVirtualizer({
    count: ordered.length,
    getScrollElement: () => scroll.current,
    getItemKey: (index) => ordered[index].id,
    estimateSize: () => (wide ? 52 : 70),
    overscan: 8,
    initialOffset: () => useActivityViewStore.getState().scrollTop,
  });
  useVirtualizerFontSize(virtualizer);
  const anchor = useRef(useActivityViewStore.getState().scrollAnchor);
  const restoring = useRef(true);
  const restoreFrame = useRef<number | null>(null);
  const identity = ordered.map((entry) => entry.id).join("\n");
  const applied = useRef("");
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const revision = `${view.following}:${identity}`;
    if (applied.current === revision) return;
    applied.current = revision;
    if (restoring.current) return;
    if (view.following) {
      virtualizer.scrollToOffset(0);
    } else if (anchor.current) {
      const index = ordered.findIndex(
        (entry) => entry.id === anchor.current?.id,
      );
      if (index >= 0) {
        // 通过稳定操作身份锚定可见行，历史补读或内存淘汰不能把阅读位置顶走。
        const offset = virtualizer.getOffsetForIndex(index, "start")?.[0];
        if (offset !== undefined)
          virtualizer.scrollToOffset(offset + anchor.current.offset);
      }
    }
  }, [identity, view.following, ordered, virtualizer]);
  useLayoutEffect(() => {
    if (!restoring.current || !ordered.length) return;
    let frames = 0;
    const following = useActivityViewStore.getState().following;
    const savedAnchor = following ? null : anchor.current;
    const index = savedAnchor
      ? ordered.findIndex((entry) => entry.id === savedAnchor.id)
      : -1;

    const restore = () => {
      const element = scroll.current;
      if (!element || !restoring.current) return;
      const rows = Array.from(
        element.querySelectorAll<HTMLElement>("[data-operation]"),
      );
      const row = rows.find(
        (item) => item.dataset.operation === savedAnchor?.id,
      );
      if (following) {
        element.scrollTop = 0;
      } else if (row && savedAnchor) {
        element.scrollTop +=
          row.getBoundingClientRect().top -
          element.getBoundingClientRect().top +
          savedAnchor.offset;
      } else if (index >= 0) {
        virtualizer.scrollToIndex(index, { align: "start" });
      }
      // 等虚拟行完成测量后再恢复焦点；恢复期间不把估算位置写回视图状态。
      if (++frames < 4) {
        restoreFrame.current = requestAnimationFrame(restore);
      } else {
        restoring.current = false;
        const focused = rows.find(
          (item) =>
            item.dataset.operation ===
            useActivityViewStore.getState().focusedOperation,
        );
        focused?.focus({ preventScroll: true });
        useActivityViewStore
          .getState()
          .saveScroll(element.scrollTop, following, savedAnchor);
      }
    };

    restoreFrame.current = requestAnimationFrame(restore);
    return () => {
      if (restoreFrame.current !== null)
        cancelAnimationFrame(restoreFrame.current);
    };
  }, [identity, ordered, virtualizer]);
  const activeFilter =
    view.query ||
    view.source !== "all" ||
    view.filter !== "all" ||
    view.range !== "all";
  return (
    <>
      {history.error ? (
        <div
          role="alert"
          className="text-destructive flex items-center gap-2 text-sm"
        >
          <span className="min-w-0 flex-1 wrap-break-word">
            <Trans>读取历史摘要失败</Trans> · {describeError(history.error, t)}
          </span>
          <Button
            variant="outline"
            size="sm"
            density="adaptive"
            disabled={history.loading || history.busy}
            onClick={() => void history.reload()}
          >
            <Trans>重试</Trans>
          </Button>
        </div>
      ) : null}
      {logs.error ? (
        <p role="alert" className="text-destructive text-sm wrap-break-word">
          <Trans>读取执行详情失败</Trans> · {describeError(logs.error, t)}
        </p>
      ) : null}
      {logs.discarded ? (
        <p className="text-muted-foreground text-xs">
          <Trans>执行详情仅保留最近记录，历史摘要仍可查看。</Trans>
        </p>
      ) : null}
      {history.logs.length >= 500 ? (
        <p className="text-muted-foreground text-xs">
          <Trans>当前显示最近 500 条历史摘要。</Trans>
        </p>
      ) : null}
      <div
        aria-hidden
        className={cn(
          "text-muted-foreground hidden shrink-0 gap-3 border-b pb-2 text-xs lg:grid",
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
        <span className="text-right">
          <Trans>结果</Trans>
        </span>
      </div>
      <div
        ref={scroll}
        role="region"
        aria-label={t`日志记录`}
        tabIndex={0}
        className="app-scroll-safe-end focus-visible:ring-ring min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2"
        onScroll={(event) => {
          if (restoring.current) return;
          const top = event.currentTarget.scrollTop;
          const item = virtualizer
            .getVirtualItems()
            .find((item) => item.end > top);
          anchor.current = item
            ? { id: ordered[item.index].id, offset: top - item.start }
            : null;
          view.saveScroll(top, top < 24, anchor.current);
        }}
        onWheel={() => {
          restoring.current = false;
        }}
        onTouchStart={() => {
          restoring.current = false;
        }}
      >
        {ordered.length ? (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <ExecutionLogRow
                  entry={ordered[item.index]}
                  sourceLabels={history.sourceLabels}
                  resultLabels={history.resultLabels}
                />
              </div>
            ))}
          </div>
        ) : logs.loading || history.loading ? (
          <p
            role="status"
            className="text-muted-foreground py-8 text-center text-sm"
          >
            <Trans>加载中…</Trans>
          </p>
        ) : !logs.error && !history.error ? (
          <Empty className="min-h-40">
            <EmptyHeader>
              <EmptyTitle>
                {activeFilter ? (
                  <Trans>无匹配结果</Trans>
                ) : (
                  <Trans>暂无日志</Trans>
                )}
              </EmptyTitle>
            </EmptyHeader>
            {activeFilter ? (
              <Button
                variant="ghost"
                size="sm"
                density="adaptive"
                onClick={() =>
                  useActivityViewStore.setState({
                    query: "",
                    source: "all",
                    filter: "all",
                    range: "all",
                    scrollTop: 0,
                    following: true,
                  })
                }
              >
                <Trans>显示全部</Trans>
              </Button>
            ) : null}
          </Empty>
        ) : null}
      </div>
    </>
  );
}
