import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

import type { BtTaskInfo } from "~/types";

import TaskRow, { type TaskRowProps } from "./TaskRow";

export default function TaskList({
  tasks,
  rowProps,
}: {
  tasks: BtTaskInfo[];
  rowProps: (task: BtTaskInfo) => Omit<TaskRowProps, "task">;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scroller.current,
    getItemKey: (index) => tasks[index].infoHash,
    estimateSize: () => 148,
    overscan: 4,
  });
  return (
    <div
      ref={scroller}
      className="app-scroll-safe-end min-h-0 flex-1 overflow-y-auto"
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full pb-3"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            <TaskRow task={tasks[row.index]} {...rowProps(tasks[row.index])} />
          </div>
        ))}
      </div>
    </div>
  );
}
