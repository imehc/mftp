import { useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CalendarDays } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Checkbox } from "~/components/ui/checkbox";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import TodoRowActionsDesktop from "./TodoRowActions.desktop";
import TodoRowActionsMobile from "./TodoRowActions.mobile";
import TodoDetailsDialog from "./TodoDetailsDialog";
import TodoTimestamps from "./TodoTimestamps";
import { cn } from "cn";
import type { TodoItem } from "~/types";
import {
  buildTodoListRows,
  formatTodoDate,
  type TodoListRow,
} from "./todo-utils";

interface TodoListProps {
  items: TodoItem[];
  pendingIds: Set<string>;
  onToggle: (item: TodoItem) => void;
  onEdit: (item: TodoItem) => void;
  onDelete: (item: TodoItem) => void;
}

function TodoRow({
  row,
  pending,
  onToggle,
  onEdit,
  onDelete,
  onViewDetails,
  compactActions,
}: {
  row: Extract<TodoListRow, { kind: "item" }>;
  pending: boolean;
  compactActions: boolean;
  onToggle: (item: TodoItem) => void;
  onEdit: (item: TodoItem) => void;
  onDelete: (item: TodoItem) => void;
  onViewDetails: (item: TodoItem) => void;
}) {
  const { t } = useLingui();
  const { item } = row;
  const RowActions = compactActions
    ? TodoRowActionsMobile
    : TodoRowActionsDesktop;
  const actions = (
    <RowActions
      disabled={pending}
      onEdit={() => onEdit(item)}
      onDelete={() => onDelete(item)}
    />
  );
  const toggleLabel = item.completed ? t`标记为未完成` : t`标记为完成`;
  return (
    <div className="pb-2">
      <div
        className="border-border bg-card relative grid min-h-14 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-lg border px-2.5 py-2"
        onClick={(event) => {
          const target = event.target;
          // Portal 菜单的事件仍沿 React 树冒泡，不应顺带打开卡片详情。
          if (
            !(target instanceof Element) ||
            !event.currentTarget.contains(target) ||
            target.closest('button, input, label, a, [role="checkbox"]')
          )
            return;
          onViewDetails(item);
        }}
      >
        {compactActions ? (
          <div className="absolute top-1.5 right-1.5">{actions}</div>
        ) : null}
        <label
          data-slot="touch-label"
          className={cn(
            "flex shrink-0 items-center justify-center self-start",
            compactActions && "row-span-2 items-start pt-0.5",
          )}
        >
          <Checkbox
            className="md:mt-0.5"
            checked={item.completed}
            disabled={pending}
            onCheckedChange={() => onToggle(item)}
            aria-label={toggleLabel}
            title={toggleLabel}
          />
        </label>
        <button
          type="button"
          onClick={() => onViewDetails(item)}
          title={t({
            message: "查看详情",
            comment: "打开待办的完整内容和时间信息",
          })}
          className={cn(
            "focus-visible:ring-ring min-w-0 cursor-pointer self-center text-left outline-none focus-visible:ring-2",
            compactActions && "col-span-2 self-start",
          )}
        >
          <span
            title={item.title}
            className={cn(
              "block min-w-0 text-sm font-medium break-words",
              compactActions && "line-clamp-2",
            )}
          >
            {item.category ? (
              <Badge
                variant="outline"
                className="mr-1.5 max-w-20 min-w-0 align-text-bottom"
                title={item.category}
              >
                <span className="truncate">{item.category}</span>
              </Badge>
            ) : null}
            <span
              className={cn(
                item.completed && "text-muted-foreground line-through",
              )}
            >
              {item.title}
            </span>
          </span>
        </button>
        {!compactActions ? actions : null}
        {item.notes ? (
          <button
            type="button"
            title={item.notes}
            aria-label={t`查看详情`}
            onClick={() => onViewDetails(item)}
            className={cn(
              "text-muted-foreground focus-visible:ring-ring col-span-2 col-start-2 mt-1 min-h-6 w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-left text-xs leading-4 break-words whitespace-pre-wrap focus-visible:ring-2 focus-visible:outline-none md:min-h-0",
              item.completed && "opacity-70",
            )}
          >
            <span className="line-clamp-2">{item.notes}</span>
          </button>
        ) : null}
        <div className="col-span-2 col-start-2 mt-1 flex min-w-0 items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <TodoTimestamps item={item} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TodoList({
  items,
  pendingIds,
  onToggle,
  onEdit,
  onDelete,
}: TodoListProps) {
  const { i18n } = useLingui();
  const desktopActions = useDesktopLayout();
  const parentRef = useRef<HTMLDivElement>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const detailsItem = items.find((item) => item.id === detailsId) ?? null;
  const rows = buildTodoListRows(items);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => rows[index]?.key ?? index,
    estimateSize: (index) => (rows[index]?.kind === "header" ? 32 : 70),
    overscan: 8,
  });

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
                    row={row}
                    compactActions={!desktopActions}
                    pending={pendingIds.has(row.item.id)}
                    onToggle={onToggle}
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
