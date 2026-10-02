import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import LogRowDesktop, { LogTableHead } from "./LogRow.desktop";
import LogRowMobile from "./LogRow.mobile";
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
    estimateSize: () => (wide ? 60 : 145),
    overscan: 8,
  });
  return (
    <>
      {wide ? <LogTableHead /> : null}
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
              {wide ? (
                <LogRowDesktop log={c.filtered[item.index]} controller={c} />
              ) : (
                <div className="px-3 md:px-4">
                  <LogRowMobile log={c.filtered[item.index]} controller={c} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
