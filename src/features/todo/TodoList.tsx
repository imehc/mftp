import { useLayoutEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CalendarDays, Pencil, Trash2 } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
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
  onViewNotes,
}: {
  row: Extract<TodoListRow, { kind: "item" }>;
  pending: boolean;
  onToggle: (item: TodoItem) => void;
  onEdit: (item: TodoItem) => void;
  onDelete: (item: TodoItem) => void;
  onViewNotes: (item: TodoItem) => void;
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
            <button
              type="button"
              title={item.notes}
              aria-label={t`查看完整备注`}
              onClick={() => onViewNotes(item)}
              className={cn(
                "text-muted-foreground focus-visible:ring-ring mt-1 line-clamp-2 max-h-8 w-full cursor-pointer appearance-none overflow-hidden border-0 bg-transparent p-0 text-left text-xs leading-4 break-words whitespace-pre-wrap focus-visible:ring-2 focus-visible:outline-none",
                item.completed && "opacity-70",
              )}
            >
              {item.notes}
            </button>
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
  const [notesItem, setNotesItem] = useState<TodoItem | null>(null);
  const rows = buildTodoListRows(items);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => rows[index]?.key ?? index,
    estimateSize: (index) => (rows[index]?.kind === "header" ? 40 : 70),
    overscan: 8,
  });

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [items, virtualizer]);

  return (
    <>
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
                    onViewNotes={setNotesItem}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Dialog
        open={notesItem !== null}
        onOpenChange={(open) => !open && setNotesItem(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="pr-8 break-words">
              {notesItem?.title}
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-foreground break-words whitespace-pre-wrap">
            {notesItem?.notes}
          </DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
}
