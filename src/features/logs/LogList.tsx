import { Trans } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "cn";
import { useRef } from "react";

import { useVirtualizerFontSize } from "~/lib/root-font-size";
import { useDesktopLayout } from "~/lib/use-desktop-layout";

import LogRow, { LOG_COLUMNS } from "./LogRow";
import type { ActivityLogsController } from "./use-activity-logs";

export default function LogList({
  controller: c,
}: {
  controller: ActivityLogsController;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const wide = useDesktopLayout();
  const virtualizer = useVirtualizer({
    count: c.filtered.length,
    getScrollElement: () => viewport.current,
    getItemKey: (i) => c.filtered[i].id,
    estimateSize: () => (wide ? 52 : 70),
    overscan: 8,
  });
  useVirtualizerFontSize(virtualizer);
  return (
    <>
      {wide ? (
        <div
          aria-hidden
          className={cn(
            "text-muted-foreground grid shrink-0 items-center gap-3 border-b px-4 py-2 text-xs",
            LOG_COLUMNS,
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
      ) : null}
      <div
        ref={viewport}
        className="app-scroll-safe-end min-h-0 flex-1 overflow-y-auto"
      >
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
              <LogRow log={c.filtered[item.index]} controller={c} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
