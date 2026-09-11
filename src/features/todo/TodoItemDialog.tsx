import { useEffect } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { X } from "lucide-react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { firstFormError } from "~/lib/form-errors";
import type { TodoItem, TodoItemInput } from "~/types";

interface TodoItemDialogProps {
  open: boolean;
  item: TodoItem | null;
  categories: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: TodoItemInput) => Promise<void>;
}

const emptyValues = {
  title: "",
  category: "",
  notes: "",
  dueDate: "",
  completed: false,
};

function toFormValues(item: TodoItem | null) {
  if (!item) return emptyValues;
  return {
    title: item.title,
    category: item.category ?? "",
    notes: item.notes ?? "",
    dueDate: item.dueDate ?? "",
    completed: item.completed,
  };
}

export default function TodoItemDialog({
  open,
  item,
  categories,
  onOpenChange,
  onSubmit,
}: TodoItemDialogProps) {
  const { t } = useLingui();
  const form = useForm({
    defaultValues: toFormValues(item),
    validators: {
      onSubmit: z.object({
        title: z
          .string()
          .trim()
          .min(1, t`请输入待办标题`),
        category: z.string(),
        notes: z.string(),
        dueDate: z.string(),
        completed: z.boolean(),
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
        completed: value.completed,
      });
    },
  });

  useEffect(() => {
    if (open) form.reset(toFormValues(item));
  }, [form, item, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {item ? <Trans>编辑待办</Trans> : <Trans>新建待办</Trans>}
          </DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="title">
            {(field) => {
              const error = firstFormError(field.state.meta.errors);
              return (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="todo-title">
                    <Trans>标题</Trans>
                  </Label>
                  <Input
                    id="todo-title"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={!!error}
                    autoFocus
                  />
                  {error ? (
                    <p className="text-destructive text-xs">{error}</p>
                  ) : null}
                </div>
              );
            }}
          </form.Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <form.Field name="category">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="todo-category">
                    <Trans>分类</Trans>
                  </Label>
                  <Input
                    id="todo-category"
                    list="todo-category-options"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="dueDate">
              {(field) => {
                const clearLabel = t`清除日期`;
                return (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="todo-due-date">
                      <Trans>日期</Trans>
                    </Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        id="todo-due-date"
                        type="date"
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                      {field.state.value ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => field.handleChange("")}
                          aria-label={clearLabel}
                          title={clearLabel}
                        >
                          <X />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              }}
            </form.Field>
          </div>
          <datalist id="todo-category-options">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>

          <form.Field name="notes">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="todo-notes">
                  <Trans>备注</Trans>
                </Label>
                <Textarea
                  id="todo-notes"
                  rows={4}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </div>
            )}
          </form.Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              <Trans>取消</Trans>
            </Button>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting}>
                  <Trans>保存</Trans>
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
