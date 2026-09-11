import type { TodoItem } from "~/types";

export const ALL_TODO_CATEGORIES = "__all__";
export type TodoView = "active" | "overdue" | "completed";

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todoView(item: TodoItem, today: string): TodoView {
  if (item.completed) return "completed";
  if (item.dueDate && item.dueDate < today) return "overdue";
  return "active";
}

export function sortTodoItems(items: TodoItem[]): TodoItem[] {
  return [...items].sort((left, right) => {
    const leftDate = left.dueDate ?? null;
    const rightDate = right.dueDate ?? null;
    if (leftDate !== rightDate) {
      if (leftDate === null) return 1;
      if (rightDate === null) return -1;
      return leftDate.localeCompare(rightDate);
    }
    if (left.completed !== right.completed) {
      return left.completed ? 1 : -1;
    }
    return right.updatedAt - left.updatedAt;
  });
}

export type TodoListRow =
  | { kind: "header"; key: string; dueDate: string | null; count: number }
  | { kind: "item"; key: string; item: TodoItem };

export function buildTodoListRows(items: TodoItem[]): TodoListRow[] {
  const rows: TodoListRow[] = [];
  let currentDate: string | null | undefined;
  let headerIndex = -1;
  for (const item of sortTodoItems(items)) {
    const dueDate = item.dueDate ?? null;
    if (dueDate !== currentDate) {
      currentDate = dueDate;
      headerIndex = rows.length;
      rows.push({
        kind: "header",
        key: `header-${dueDate ?? "unscheduled"}`,
        dueDate,
        count: 0,
      });
    }
    const header = rows[headerIndex];
    if (header?.kind === "header") header.count += 1;
    rows.push({ kind: "item", key: item.id, item });
  }
  return rows;
}

export function formatTodoDate(value: string, locale: string): string {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}
