import { useEffect, useState, type ReactNode } from "react";
import { useForm } from "@tanstack/react-form";
import { Trans, useLingui } from "@lingui/react/macro";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "~/components/ui/alert-dialog";
import CandidateInput from "~/components/CandidateInput";
import { Input } from "~/components/ui/input";
import { PasswordInput } from "~/components/ui/password-input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { firstFormError } from "~/lib/form-errors";
import type { VaultEntry, VaultEntryInput } from "~/types";
interface Props {
  open: boolean;
  busy: boolean;
  /** 编辑时传入已有条目；新建时为 null。 */
  entry: VaultEntry | null;
  /** 已知的分类，作为共享候选输入的建议。 */
  categories: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: VaultEntryInput) => Promise<void>;
}
const emptyValues = {
  title: "",
  url: "",
  username: "",
  password: "",
  category: "",
  notes: "",
};
function toFormValues(entry: VaultEntry | null) {
  if (!entry) return emptyValues;
  return {
    title: entry.title,
    url: entry.url ?? "",
    username: entry.username ?? "",
    password: entry.password ?? "",
    category: entry.category ?? "",
    notes: entry.notes ?? "",
  };
}
export default function VaultEntryDialog({
  open,
  busy,
  entry,
  categories,
  onOpenChange,
  onSubmit,
}: Props) {
  const { t } = useLingui();
  const [discard, setDiscard] = useState(false);
  const form = useForm({
    defaultValues: toFormValues(entry),
    validators: {
      onSubmit: z.object({
        title: z
          .string()
          .trim()
          .min(1, t`请输入内容`),
        url: z.string(),
        username: z.string().trim(),
        password: z.string(),
        category: z.string(),
        notes: z.string(),
      }),
    },
    onSubmit: async ({ value }) => {
      const trimmedUrl = value.url.trim();
      const trimmedUsername = value.username.trim();
      const trimmedCategory = value.category.trim();
      const trimmedNotes = value.notes.trim();
      await onSubmit({
        title: value.title.trim(),
        url: trimmedUrl ? trimmedUrl : null,
        username: trimmedUsername ? trimmedUsername : null,
        password: value.password ? value.password : null,
        category: trimmedCategory ? trimmedCategory : null,
        notes: trimmedNotes ? trimmedNotes : null,
      });
    },
  });
  useEffect(() => {
    if (open) form.reset(toFormValues(entry));
  }, [form, open, entry]);
  const textField = (
    name: "title" | "url" | "username" | "password" | "category",
    label: ReactNode,
    props?: {
      type?: string;
      placeholder?: string;
      list?: string;
    },
  ) => (
    <form.Field name={name}>
      {(field) => {
        const error = firstFormError(field.state.meta.errors);
        const Control =
          name === "category" ? (
            <CandidateInput
              id="vault-category"
              value={field.state.value}
              candidates={categories}
              onChange={field.handleChange}
              required={false}
              disabled={busy}
            />
          ) : props?.type === "password" ? (
            <PasswordInput
              id={`vault-${name}`}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? `vault-${name}-error` : undefined}
              {...props}
            />
          ) : (
            <Input
              id={`vault-${name}`}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? `vault-${name}-error` : undefined}
              autoComplete="off"
              {...props}
            />
          );
        return (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`vault-${name}`}>{label}</Label>
            {Control}
            {error ? (
              <p
                id={`vault-${name}-error`}
                className="text-destructive text-xs"
              >
                {error}
              </p>
            ) : null}
          </div>
        );
      }}
    </form.Field>
  );
  function close() {
    if (busy) return;
    if (form.state.isDirty) setDiscard(true);
    else onOpenChange(false);
  }
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogLayoutContent
          placement="responsive-page"
          className="ui-density-adaptive md:max-w-md"
          aria-describedby={undefined}
          showCloseButton={false}
        >
          <DialogLayoutHeader showCloseButton>
            <DialogTitle>
              {entry ? <Trans>编辑账号</Trans> : <Trans>新建账号</Trans>}
            </DialogTitle>
          </DialogLayoutHeader>
          <DialogLayoutBody>
            <form
              id="vault-entry-form"
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                void form.handleSubmit();
              }}
            >
              <fieldset
                disabled={busy}
                className="flex min-w-0 flex-col gap-3 p-1"
              >
                {textField("title", <Trans>标题</Trans>)}
                {textField("username", <Trans>账号</Trans>)}
                {textField("password", <Trans>密码</Trans>, {
                  type: "password",
                })}
                {textField("url", <Trans>网址</Trans>, {
                  placeholder: "https://",
                })}
                {textField("category", <Trans>分类</Trans>)}
                <form.Field name="notes">
                  {(field) => (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="vault-notes">
                        <Trans>备注</Trans>
                      </Label>
                      <Textarea
                        id="vault-notes"
                        rows={3}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </div>
                  )}
                </form.Field>
              </fieldset>
            </form>
          </DialogLayoutBody>
          <DialogLayoutFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              <Trans>取消</Trans>
            </Button>
            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(submitting) => (
                <Button
                  type="submit"
                  form="vault-entry-form"
                  disabled={busy || submitting}
                >
                  <Trans>保存</Trans>
                </Button>
              )}
            </form.Subscribe>
          </DialogLayoutFooter>
        </DialogLayoutContent>
      </Dialog>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent className="ui-density-adaptive">
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>放弃未保存的修改？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>关闭后，本次修改不会保存。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>继续编辑</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDiscard(false);
                onOpenChange(false);
              }}
            >
              <Trans>放弃修改</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
