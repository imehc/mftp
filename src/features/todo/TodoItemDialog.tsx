import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { enUS, zhCN } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Textarea } from "~/components/ui/textarea";
import { firstFormError } from "~/lib/form-errors";
import { cn } from "~/lib/utils";
import type { TodoItem, TodoItemInput } from "~/types";
import { localDateKey, todoDateFromKey } from "./todo-utils";

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
  if (!item) return { ...emptyValues };
  return {
    title: item.title,
    category: item.category ?? "",
    notes: item.notes ?? "",
    dueDate: item.dueDate ?? "",
    completed: item.completed,
  };
}

function TodoDatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { i18n, t } = useLingui();
  const [open, setOpen] = useState(false);
  const selectedDate = value ? todoDateFromKey(value) : undefined;
  const locale = i18n.locale.startsWith("zh") ? zhCN : enUS;
  const clearLabel = t`清除日期`;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="todo-due-date"
            type="button"
            variant="outline"
            className="min-w-0 flex-1 justify-start font-normal"
          >
            <CalendarIcon data-icon="inline-start" />
            <span
              className={cn(
                "truncate",
                !selectedDate && "text-muted-foreground",
              )}
            >
              {selectedDate
                ? new Intl.DateTimeFormat(i18n.locale, {
                    dateStyle: "medium",
                  }).format(selectedDate)
                : t`选择日期`}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            locale={locale}
            selected={selectedDate}
            defaultMonth={selectedDate}
            onSelect={(date) => {
              onChange(date ? localDateKey(date) : "");
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {value ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onChange("")}
          aria-label={clearLabel}
          title={clearLabel}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
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
      <DialogContent className="sm:max-w-lg">
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
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="todo-due-date">
                    <Trans>日期</Trans>
                  </Label>
                  <TodoDatePicker
                    value={field.state.value}
                    onChange={field.handleChange}
                  />
                </div>
              )}
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
