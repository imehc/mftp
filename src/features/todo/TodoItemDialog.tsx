import { Trans } from "@lingui/react/macro";

import CandidateInput from "~/components/CandidateInput";
import { Button } from "~/components/ui/button";
import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { firstFormError } from "~/lib/form-errors";
import type { TodoItem, TodoItemInput } from "~/types";

import { useTodoEditor } from "./hooks/use-todo-editor";
import TodoSchedulePicker from "./TodoSchedulePicker";

interface TodoItemDialogProps {
  open: boolean;
  item: TodoItem | null;
  categories: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: TodoItemInput) => Promise<void>;
}

export default function TodoItemDialog({
  open,
  item,
  categories,
  onOpenChange,
  onSubmit,
}: TodoItemDialogProps) {
  const form = useTodoEditor({ open, item, onSubmit });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogLayoutContent
        placement="responsive-page"
        className="ui-density-adaptive md:max-w-lg"
        aria-describedby={undefined}
        showCloseButton={false}
      >
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            {item ? <Trans>编辑待办</Trans> : <Trans>新建待办</Trans>}
          </DialogTitle>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          <form
            id="todo-item-form"
            className="p-1"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <FieldGroup density="compact">
              <form.Field name="title">
                {(field) => {
                  const error = firstFormError(field.state.meta.errors);
                  return (
                    <Field data-invalid={!!error}>
                      <FieldLabel htmlFor="todo-title">
                        <Trans>标题</Trans>
                      </FieldLabel>
                      <Input
                        id="todo-title"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        aria-invalid={!!error}
                        aria-describedby={
                          error ? "todo-title-error" : undefined
                        }
                        autoFocus
                      />
                      {error ? (
                        <FieldError id="todo-title-error">{error}</FieldError>
                      ) : null}
                    </Field>
                  );
                }}
              </form.Field>

              <FieldGroup density="compact" className="md:grid md:grid-cols-2">
                <form.Field name="category">
                  {(field) => (
                    <Field className="md:col-span-2">
                      <FieldLabel htmlFor="todo-category">
                        <Trans>分类</Trans>
                      </FieldLabel>
                      <CandidateInput
                        id="todo-category"
                        candidates={categories}
                        required={false}
                        value={field.state.value}
                        onChange={field.handleChange}
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="dueDate">
                  {(dateField) => (
                    <form.Field name="dueTime">
                      {(timeField) => {
                        const error = firstFormError(
                          timeField.state.meta.errors,
                        );
                        return (
                          <Field
                            className="md:col-span-2"
                            data-invalid={!!error}
                          >
                            <FieldLabel htmlFor="todo-schedule">
                              <Trans>计划时间</Trans>
                            </FieldLabel>
                            <TodoSchedulePicker
                              date={dateField.state.value}
                              time={timeField.state.value}
                              error={!!error}
                              onChange={(date, time) => {
                                dateField.handleChange(date);
                                timeField.handleChange(time);
                              }}
                            />
                            {error ? (
                              <FieldError id="todo-time-error">
                                {error}
                              </FieldError>
                            ) : null}
                          </Field>
                        );
                      }}
                    </form.Field>
                  )}
                </form.Field>
              </FieldGroup>

              <form.Field name="notes">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="todo-notes">
                      <Trans>备注</Trans>
                    </FieldLabel>
                    <Textarea
                      id="todo-notes"
                      rows={4}
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                  </Field>
                )}
              </form.Field>
            </FieldGroup>
          </form>
        </DialogLayoutBody>
        <DialogLayoutFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            <Trans>取消</Trans>
          </Button>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button
                type="submit"
                form="todo-item-form"
                disabled={isSubmitting}
              >
                <Trans>保存</Trans>
              </Button>
            )}
          </form.Subscribe>
        </DialogLayoutFooter>
      </DialogLayoutContent>
    </Dialog>
  );
}
