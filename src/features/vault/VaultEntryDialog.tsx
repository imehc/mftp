import { useEffect, type ReactNode } from "react";
import { useForm } from "@tanstack/react-form";
import { Trans, useLingui } from "@lingui/react/macro";
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
import type { VaultEntry, VaultEntryInput } from "~/types";

interface Props {
  open: boolean;
  /** Existing entry when editing; null when creating. */
  entry: VaultEntry | null;
  /** Known categories offered as datalist suggestions. */
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
  entry,
  categories,
  onOpenChange,
  onSubmit,
}: Props) {
  const { t } = useLingui();
  const form = useForm({
    defaultValues: toFormValues(entry),
    validators: {
      onSubmit: z.object({
        title: z.string().trim().min(1, t`请输入内容`),
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
    props?: { type?: string; placeholder?: string; list?: string },
  ) => (
    <form.Field name={name}>
      {(field) => {
        const error = firstFormError(field.state.meta.errors);
        return (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`vault-${name}`}>{label}</Label>
            <Input
              id={`vault-${name}`}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              aria-invalid={!!error}
              autoComplete="off"
              {...props}
            />
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}
          </div>
        );
      }}
    </form.Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {entry ? <Trans>编辑账号</Trans> : <Trans>新增账号</Trans>}
          </DialogTitle>
        </DialogHeader>
        <form
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-3"
        >
          {textField("title", <Trans>标题</Trans>)}
          <div className="grid gap-3 sm:grid-cols-2">
            {textField("username", <Trans>账号</Trans>)}
            {textField("password", <Trans>密码</Trans>, { type: "password" })}
          </div>
          {textField("url", <Trans>网址</Trans>, {
            placeholder: "https://",
          })}
          {textField("category", <Trans>分类</Trans>, {
            list: "vault-category-options",
          })}
          <datalist id="vault-category-options">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              <Trans>取消</Trans>
            </Button>
            <form.Subscribe selector={(s) => s.isSubmitting}>
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
