import { useRef } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CalendarDays, Pencil, Trash2 } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { cn } from "~/lib/utils";
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
}: {
  row: Extract<TodoListRow, { kind: "item" }>;
  pending: boolean;
  onToggle: (item: TodoItem) => void;
  onEdit: (item: TodoItem) => void;
  onDelete: (item: TodoItem) => void;
}) {
  const { t } = useLingui();
  const { item } = row;
  const toggleLabel = item.completed ? t`标记为未完成` : t`标记为完成`;
  return (
    <div className="px-1 pb-1.5 sm:px-1.5">
      <div className="border-border bg-card flex min-h-14 items-start gap-2 rounded-lg border px-2.5 py-2">
        <Checkbox
          className="mt-0.5"
          checked={item.completed}
          disabled={pending}
          onCheckedChange={() => onToggle(item)}
          aria-label={toggleLabel}
          title={toggleLabel}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "min-w-0 text-sm font-medium break-words",
                item.completed && "text-muted-foreground line-through",
              )}
            >
              {item.title}
            </span>
            {item.category ? (
              <Badge variant="outline">{item.category}</Badge>
            ) : null}
          </div>
          {item.notes ? (
            <p
              className={cn(
                "text-muted-foreground mt-1 text-xs break-words whitespace-pre-wrap",
                item.completed && "opacity-70",
              )}
            >
              {item.notes}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onEdit(item)}
            aria-label={t`编辑待办`}
            title={t`编辑待办`}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onDelete(item)}
            aria-label={t`删除待办`}
            title={t`删除待办`}
          >
            <Trash2 />
          </Button>
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
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = buildTodoListRows(items);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.kind === "header" ? 40 : 70),
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
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
                <div className="text-muted-foreground flex h-10 items-center gap-2 px-1.5 text-xs font-medium">
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
                  pending={pendingIds.has(row.item.id)}
                  onToggle={onToggle}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
