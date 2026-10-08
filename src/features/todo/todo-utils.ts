import { format, isThisYear } from "date-fns";

import { dateLocale } from "~/lib/date-locale";
import type { TodoItem } from "~/types";

export const ALL_TODO_CATEGORIES = "__all__";

export type TodoView = "active" | "overdue" | "completed";

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todoDateFromKey(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

export function plannedDate(item: TodoItem): string | null {
  return item.dueAt != null
    ? localDateKey(new Date(item.dueAt))
    : (item.dueDate ?? null);
}

export function localTimeKey(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 本地输入转换为绝对时间，并拒绝日期溢出或夏令时跳过的时刻。 */
export function plannedTimestamp(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    return null;
  const value = new Date(`${date}T${time}:00`);
  const timestamp = value.getTime();
  if (
    !Number.isFinite(timestamp) ||
    timestamp < 0 ||
    timestamp > 253402300799999
  )
    return null;
  return localDateKey(value) === date && localTimeKey(value) === time
    ? timestamp
    : null;
}

export function formatTodoTimestamp(
  value: number,
  locale: string,
  compact = false,
): string {
  const datePattern =
    compact && isThisYear(value)
      ? "MM/dd"
      : locale.startsWith("zh")
        ? "yyyy/MM/dd"
        : "MM/dd/yyyy";
  return format(value, `${datePattern} HH:mm`, { locale: dateLocale(locale) });
}

export function todoView(item: TodoItem, now: number): TodoView {
  if (item.completed) return "completed";
  if (item.dueAt != null) return item.dueAt <= now ? "overdue" : "active";
  if (item.dueDate && item.dueDate < localDateKey(new Date(now)))
    return "overdue";
  return "active";
}

export function sortTodoItems(items: TodoItem[]): TodoItem[] {
  return [...items].sort((left, right) => {
    const leftDate = plannedDate(left);
    const rightDate = plannedDate(right);
    if (leftDate !== rightDate) {
      if (leftDate === null) return 1;
      if (rightDate === null) return -1;
      return leftDate.localeCompare(rightDate);
    }
    // 同一计划日先按时刻排序；未指定时刻的日期型待办放在该组开头。
    if (left.dueAt !== right.dueAt)
      return (left.dueAt ?? 0) - (right.dueAt ?? 0);
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
    const dueDate = plannedDate(item);
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

export function formatTodoDate(
  value: string,
  locale: string,
  compact = false,
): string {
  const date = todoDateFromKey(value);
  const pattern = compact
    ? isThisYear(date)
      ? "MM/dd"
      : locale.startsWith("zh")
        ? "yyyy/MM/dd"
        : "MM/dd/yyyy"
    : "PPP EEE";
  return format(date, pattern, { locale: dateLocale(locale) });
}

/** 搜索只作用于当前视图，不改变计划日期分组与排序。 */
export function matchesTodoQuery(item: TodoItem, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  return (
    !normalized ||
    [item.title, item.notes, item.category].some((value) =>
      value?.toLocaleLowerCase().includes(normalized),
    )
  );
}
