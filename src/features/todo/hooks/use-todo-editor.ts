import { useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { useEffect } from "react";
import { z } from "zod";

import type { TodoItem, TodoItemInput } from "~/types";

import { localTimeKey, plannedDate, plannedTimestamp } from "../todo-utils";

const emptyValues = {
  title: "",
  category: "",
  notes: "",
  dueDate: "",
  dueTime: "",
  completed: false,
};

function toFormValues(item: TodoItem | null) {
  if (!item) return { ...emptyValues };
  return {
    title: item.title,
    category: item.category ?? "",
    notes: item.notes ?? "",
    dueDate: plannedDate(item) ?? "",
    dueTime: item.dueAt != null ? localTimeKey(new Date(item.dueAt)) : "",
    completed: item.completed,
  };
}

/** 编辑草稿与校验不依赖桌面/移动布局，断点切换不重建表单。 */
export function useTodoEditor({
  open,
  item,
  onSubmit,
}: {
  open: boolean;
  item: TodoItem | null;
  onSubmit: (input: TodoItemInput) => Promise<void>;
}) {
  const { t } = useLingui();
  const form = useForm({
    defaultValues: toFormValues(item),
    validators: {
      onSubmit: z
        .object({
          title: z
            .string()
            .trim()
            .min(1, t`请输入待办标题`),
          category: z.string(),
          notes: z.string(),
          dueDate: z.string(),
          dueTime: z.string(),
          completed: z.boolean(),
        })
        .superRefine((value, context) => {
          if (
            value.dueTime &&
            plannedTimestamp(value.dueDate, value.dueTime) === null
          ) {
            context.addIssue({
              code: "custom",
              path: ["dueTime"],
              message: t`请选择有效的计划日期和时间`,
            });
          }
        }),
    },
    onSubmit: async ({ value }) => {
      const category = value.category.trim();
      const notes = value.notes.trim();
      await onSubmit({
        title: value.title.trim(),
        category: category || null,
        notes: notes || null,
        dueDate: value.dueDate || null,
        dueAt: value.dueTime
          ? plannedTimestamp(value.dueDate, value.dueTime)
          : null,
        completed: value.completed,
      });
    },
  });

  useEffect(() => {
    if (open) form.reset(toFormValues(item));
  }, [form, item, open]);

  return form;
}
