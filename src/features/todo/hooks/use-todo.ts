import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import {
  todoItemCreate,
  todoItemDelete,
  todoItemUpdate,
  todoItemsList,
} from "~/lib/ipc";
import { describeError, toIpcError } from "~/lib/errors";
import type { AppError, TodoItem, TodoItemInput } from "~/types";
import {
  ALL_TODO_CATEGORIES,
  sortTodoItems,
  matchesTodoQuery,
  todoView,
  type TodoView,
} from "../todo-utils";

/** 两端共用的待办状态与动作；布局不拥有 IPC 或异步资源。 */
export function useTodo() {
  const { t } = useLingui();
  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL_TODO_CATEGORIES);
  const [view, setView] = useState<TodoView>("active");
  const [now, setNow] = useState(Date.now);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TodoItem | null>(null);
  const [deleting, setDeleting] = useState<TodoItem | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const [loadError, setLoadError] = useState<AppError | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void todoItemsList()
      .then((nextItems) => {
        if (!cancelled) setItems(sortTodoItems(nextItems));
      })
      .catch((error) => {
        if (!cancelled) setLoadError(toIpcError(error).payload);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // 语言和布局切换不重新读取；旧请求返回不能覆盖新页面。
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  useEffect(() => {
    const refresh = () => setNow(Date.now());
    // 分钟边界刷新精确计划；从后台回来立即修正被系统暂停的计时器。
    const timer = window.setTimeout(
      refresh,
      60_000 - (Date.now() % 60_000) + 10,
    );
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [now]);

  const categories = [
    ...new Set(items.flatMap((item) => (item.category ? [item.category] : []))),
  ].sort((left, right) => left.localeCompare(right));
  const itemsByView = {
    active: items.filter((item) => todoView(item, now) === "active"),
    overdue: items.filter((item) => todoView(item, now) === "overdue"),
    completed: items.filter((item) => todoView(item, now) === "completed"),
  } satisfies Record<TodoView, TodoItem[]>;
  const filteredItems = itemsByView[view].filter(
    (item) =>
      (category === ALL_TODO_CATEGORIES || item.category === category) &&
      matchesTodoQuery(item, query),
  );

  async function handleSubmit(input: TodoItemInput) {
    try {
      if (editing) {
        const updated = await todoItemUpdate(editing.id, input);
        setItems((current) =>
          sortTodoItems(
            current.map((item) => (item.id === updated.id ? updated : item)),
          ),
        );
      } else {
        const created = await todoItemCreate(input);
        setItems((current) => sortTodoItems([...current, created]));
      }
      setDialogOpen(false);
      setEditing(null);
      toast.success(t`已保存`);
    } catch (error) {
      toast.error(t`保存待办失败`, { description: describeError(error) });
    }
  }

  async function handleToggle(item: TodoItem) {
    setPendingIds((current) => new Set(current).add(item.id));
    try {
      const updated = await todoItemUpdate(item.id, {
        title: item.title,
        category: item.category,
        notes: item.notes,
        dueDate: item.dueDate,
        dueAt: item.dueAt,
        completed: !item.completed,
      });
      setItems((current) =>
        sortTodoItems(
          current.map((entry) => (entry.id === updated.id ? updated : entry)),
        ),
      );
    } catch (error) {
      toast.error(t`更新待办失败`, { description: describeError(error) });
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await todoItemDelete(deleting.id);
      setItems((current) => current.filter((item) => item.id !== deleting.id));
      toast.success(t`已删除`);
    } catch (error) {
      toast.error(t`删除待办失败`, { description: describeError(error) });
    } finally {
      setDeleting(null);
    }
  }

  return {
    items,
    loading,
    loadError,
    retry: () => {
      setLoading(true);
      setLoadError(null);
      setLoadAttempt((value) => value + 1);
    },
    query,
    setQuery,
    category,
    setCategory,
    view,
    setView,
    categories,
    itemsByView,
    filteredItems,
    dialogOpen,
    setDialogOpen,
    editing,
    setEditing,
    deleting,
    setDeleting,
    pendingIds,
    handleSubmit,
    handleToggle,
    handleDelete,
  };
}
