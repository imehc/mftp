import { Trans, useLingui } from "@lingui/react/macro";
import { lazy, Suspense, useRef, useState } from "react";

import type { TodoNoteDraft, TodoNoteSaveInput } from "~/bindings";
import CandidateInput from "~/components/CandidateInput";
import { Alert, AlertDescription } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
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
import { Spinner } from "~/components/ui/spinner";
import { describeError } from "~/lib/errors";
import { firstFormError } from "~/lib/form-errors";
import type { TodoItem } from "~/types";

import { useTodoEditor } from "./hooks/use-todo-editor";
import type {
  NoteEditorHandle,
  NoteEditorStatus,
} from "./notes/TodoNoteEditor";
import { useNoteDraft } from "./notes/use-note-draft";
import TodoSchedulePicker from "./TodoSchedulePicker";

const TodoNoteEditor = lazy(() => import("./notes/TodoNoteEditor"));

interface TodoItemDialogProps {
  open: boolean;
  busy: boolean;
  item: TodoItem | null;
  categories: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: TodoNoteSaveInput) => Promise<void>;
}

export default function TodoItemDialog(props: TodoItemDialogProps) {
  return props.open ? (
    <TodoItemSession key={props.item?.id ?? "new"} {...props} />
  ) : null;
}

function TodoItemSession(props: TodoItemDialogProps) {
  const { t } = useLingui();
  const { draft, error, retry } = useNoteDraft(props.item?.id ?? null);
  if (draft) return <TodoItemForm {...props} draft={draft} />;
  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogLayoutContent
        placement="responsive-page"
        className="md:max-w-xl"
        aria-describedby={undefined}
        showCloseButton={false}
      >
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            {props.item ? <Trans>编辑待办</Trans> : <Trans>新建待办</Trans>}
          </DialogTitle>
        </DialogLayoutHeader>
        <DialogLayoutBody>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{describeError(error, t)}</AlertDescription>
              <Button type="button" variant="outline" onClick={retry}>
                <Trans>重试</Trans>
              </Button>
            </Alert>
          ) : (
            <div className="flex items-center gap-2 py-6 text-sm" role="status">
              <Spinner />
              <Trans>正在读取备注</Trans>
            </div>
          )}
        </DialogLayoutBody>
        <DialogLayoutFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            <Trans>取消</Trans>
          </Button>
        </DialogLayoutFooter>
      </DialogLayoutContent>
    </Dialog>
  );
}

function TodoItemForm({
  busy,
  item,
  draft,
  categories,
  onOpenChange,
  onSubmit,
}: TodoItemDialogProps & { draft: TodoNoteDraft }) {
  const editorRef = useRef<NoteEditorHandle | null>(null);
  const [status, setStatus] = useState<NoteEditorStatus>({
    draftId: draft.id,
    ready: false,
    blocked: true,
  });
  const [discard, setDiscard] = useState(false);
  const form = useTodoEditor({
    draft,
    canSubmit: () => !busy && !!editorRef.current?.canSave(),
    onSubmit: (input) => {
      const editor = editorRef.current;
      if (!editor?.canSave()) return Promise.resolve();
      return onSubmit({ ...input, document: editor.document() });
    },
  });

  function requestClose(open: boolean) {
    if (open || busy || form.state.isSubmitting) return;
    if (!form.state.isDefaultValue || editorRef.current?.isDirty())
      setDiscard(true);
    else onOpenChange(false);
  }

  return (
    <>
      <Dialog open onOpenChange={requestClose}>
        <DialogLayoutContent
          placement="responsive-page"
          className="ui-density-adaptive md:max-w-xl"
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
              <fieldset disabled={busy}>
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
                            <FieldError id="todo-title-error">
                              {error}
                            </FieldError>
                          ) : null}
                        </Field>
                      );
                    }}
                  </form.Field>

                  <FieldGroup
                    density="compact"
                    className="md:grid md:grid-cols-2"
                  >
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

                  <form.Field name="document">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="todo-notes">
                          <Trans>备注</Trans>
                        </FieldLabel>
                        <Suspense
                          fallback={
                            <div
                              className="flex min-h-36 items-center justify-center"
                              role="status"
                            >
                              <Spinner />
                              <span className="sr-only">
                                <Trans>正在加载编辑器</Trans>
                              </span>
                            </div>
                          }
                        >
                          <TodoNoteEditor
                            draft={draft}
                            disabled={busy}
                            onChange={field.handleChange}
                            onStatus={setStatus}
                            onReady={(handle) => {
                              editorRef.current = handle;
                            }}
                          />
                        </Suspense>
                      </Field>
                    )}
                  </form.Field>
                </FieldGroup>
              </fieldset>
            </form>
          </DialogLayoutBody>
          <DialogLayoutFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => requestClose(false)}
            >
              <Trans>取消</Trans>
            </Button>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button
                  type="submit"
                  form="todo-item-form"
                  disabled={
                    isSubmitting || busy || !status.ready || status.blocked
                  }
                >
                  <Trans>保存</Trans>
                </Button>
              )}
            </form.Subscribe>
          </DialogLayoutFooter>
        </DialogLayoutContent>
      </Dialog>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>放弃未保存的修改？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>未保存的文字和图片将被丢弃，已保存的备注不受影响。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>继续编辑</Trans>
            </AlertDialogCancel>
            <Button variant="destructive" onClick={() => onOpenChange(false)}>
              <Trans>放弃修改</Trans>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
