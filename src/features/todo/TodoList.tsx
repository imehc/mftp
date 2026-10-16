import { Trans, useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CalendarDays } from "lucide-react";
import { useRef, useState } from "react";

import type { TodoNoteSummary } from "~/bindings";
import { Badge } from "~/components/ui/badge";
import { useVirtualizerFontSize } from "~/lib/root-font-size";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import type { TodoItem } from "~/types";

import { buildTodoListRows, formatTodoDate } from "./todo-utils";
import TodoDetailsDialog from "./TodoDetailsDialog";
import TodoRow from "./TodoRow";

interface TodoListProps {
  items: TodoItem[];
  summaries: TodoNoteSummary[];
  pendingIds: Set<string>;
  onToggle: (item: TodoItem) => void;
  onToggleAbandon: (item: TodoItem) => void;
  onEdit: (item: TodoItem) => void;
  onDelete: (item: TodoItem) => void;
}

export default function TodoList({
  items,
  summaries,
  pendingIds,
  onToggle,
  onToggleAbandon,
  onEdit,
  onDelete,
}: TodoListProps) {
  const { i18n } = useLingui();
  const desktopActions = useDesktopLayout();
  const parentRef = useRef<HTMLDivElement>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const detailsItem = items.find((item) => item.id === detailsId) ?? null;
  const rows = buildTodoListRows(items);
  const summaryById = new Map(
    summaries.map((summary) => [summary.itemId, summary]),
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => rows[index]?.key ?? index,
    estimateSize: (index) => (rows[index]?.kind === "header" ? 32 : 70),
    overscan: 8,
  });
  useVirtualizerFontSize(virtualizer);

  // 按稳定 key 保留已测行高；尺寸变化交给 measureElement 的观察器。
  // 数据更新时清空缓存会让未变尺寸的旧行退回估算值，产生重叠。

  return (
    <>
      <div
        ref={parentRef}
        className="app-scroll-safe-end min-h-0 flex-1 overflow-auto"
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {row.kind === "header" ? (
                  <div className="text-muted-foreground flex h-8 items-center gap-2 px-1.5 text-xs font-medium">
                    <CalendarDays className="size-3.5" />
                    <span>
                      {row.dueDate ? (
                        formatTodoDate(row.dueDate, i18n.locale)
                      ) : (
                        <Trans>未安排</Trans>
                      )}
                    </span>
                    <Badge variant="secondary">{row.count}</Badge>
                  </div>
                ) : (
                  <TodoRow
                    item={row.item}
                    summary={summaryById.get(row.item.id)}
                    compactActions={!desktopActions}
                    pending={pendingIds.has(row.item.id)}
                    onToggle={onToggle}
                    onToggleAbandon={onToggleAbandon}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onViewDetails={(item) => setDetailsId(item.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <TodoDetailsDialog
        item={detailsItem}
        onClose={() => setDetailsId(null)}
      />
    </>
  );
}
