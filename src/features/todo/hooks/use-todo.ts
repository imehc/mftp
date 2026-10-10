import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useStore } from "zustand";

import { describeError } from "~/lib/errors";
import type { TodoItem, TodoItemInput } from "~/types";

import { createTodoController } from "../todo-controller";
import {
  ALL_TODO_CATEGORIES,
  groupTodoItems,
  matchesTodoQuery,
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
  const [view, setView] = useState<TodoView>("active");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    void controller.start();
    return () => controller.stop();
  }, [controller]);

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
  const itemsByView = groupTodoItems(items, now);
  const filteredItems = itemsByView[view].filter(
    (item) =>
      (category === ALL_TODO_CATEGORIES || item.category === category) &&
      matchesTodoQuery(item, query),
  );

  async function handleSubmit(input: TodoItemInput) {
    const result = await controller.submit(input);
    if (result?.ok)
      toast.success(
        t({ message: "已保存", comment: "待办新增或编辑保存成功的提示" }),
      );
    else if (result)
      toast.error(t`保存待办失败`, {
        description: describeError(result.error),
      });
  }

  async function handleToggle(item: TodoItem) {
    const result = await controller.toggle(item);
    if (result && !result.ok)
      toast.error(t`更新待办失败`, {
        description: describeError(result.error),
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
    view,
    setView,
    categories,
    itemsByView,
    filteredItems,
    handleSubmit,
    handleToggle,
    handleDelete,
  };
}
