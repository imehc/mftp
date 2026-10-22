import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useStore } from "zustand";

import type { TodoNoteSaveInput } from "~/bindings";
import { describeError } from "~/lib/errors";
import type { TodoItem } from "~/types";

import { createTodoController } from "../todo-controller";
import { startTodoLiveSync } from "../todo-live-sync";
import {
  ALL_TODO_CATEGORIES,
  ALL_TODO_PRIORITIES,
  groupTodoItems,
  matchesTodoQuery,
  TODO_PRIORITIES,
  type TodoPriorityFilter,
  type TodoView,
} from "../todo-utils";

/** 两端共用的待办状态与动作；布局不拥有 IPC 或异步资源。 */
export function useTodo() {
  const { t } = useLingui();
  const [controller] = useState(createTodoController);
  const state = useStore(controller.store);
  const { items } = state;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL_TODO_CATEGORIES);
  const [priority, setPriority] =
    useState<TodoPriorityFilter>(ALL_TODO_PRIORITIES);
  const [view, setView] = useState<TodoView>("active");
  const [now, setNow] = useState(Date.now);
  useEffect(() => startTodoLiveSync(controller), [controller]);

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
  const itemsByView = groupTodoItems(items, now, category, priority);
  const filteredItems = itemsByView[view].filter((item) =>
    matchesTodoQuery(item, query),
  );

  async function handleSubmit(input: TodoNoteSaveInput) {
    const result = await controller.submit(input);
    if (result?.ok)
      toast.success(
        t({ message: "已保存", comment: "待办新增或编辑保存成功的提示" }),
      );
    else if (result)
      toast.error(t`保存待办失败`, {
        description: describeError(result.error, t),
      });
  }

  async function handleToggle(item: TodoItem) {
    const result = await controller.toggle(item);
    if (result && !result.ok)
      toast.error(t`更新待办失败`, {
        description: describeError(result.error, t),
      });
  }

  async function handleToggleAbandon(item: TodoItem) {
    const result = await controller.abandon(item);
    if (result && !result.ok)
      toast.error(t`更新待办失败`, {
        description: describeError(result.error, t),
      });
  }

  async function handleDelete() {
    const result = await controller.remove();
    if (result?.ok)
      toast.success(t({ message: "已删除", comment: "待办删除成功的提示" }));
  }

  return {
    ...state,
    retry: controller.load,
    edit: controller.edit,
    setDialogOpen: controller.setDialogOpen,
    setDeleting: controller.setDeleting,
    query,
    setQuery,
    category,
    setCategory,
    priority,
    setPriority,
    priorities: TODO_PRIORITIES,
    view,
    setView,
    categories,
    itemsByView,
    filteredItems,
    handleSubmit,
    handleToggle,
    handleToggleAbandon,
    handleDelete,
  };
}
