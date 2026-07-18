import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { KeyRound, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useHostsStore } from "~/store/hosts";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import {
  Field as UiField,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Separator } from "~/components/ui/separator";
import { firstFormError } from "~/lib/form-errors";
import {
  emptyKeyImportFormValues,
  keyImportSchema,
} from "~/features/ssh-sftp/components/keys/KeyManager.schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function KeyManager({ open, onOpenChange }: Props) {
  const keys = useHostsStore((s) => s.keys);
  const importKey = useHostsStore((s) => s.importKey);
  const deleteKey = useHostsStore((s) => s.deleteKey);

  const [busy, setBusy] = useState(false);
  const form = useForm({
    defaultValues: emptyKeyImportFormValues,
    validators: {
      onSubmit: keyImportSchema,
    },
    onSubmit: async ({ value }) => {
      setBusy(true);
      try {
        await importKey(value.label.trim(), value.sourcePath.trim(), value.hasPassphrase);
        toast.success(`已导入密钥 ${value.label.trim()}`);
        form.reset(emptyKeyImportFormValues);
      } catch (e) {
        toast.error(String(e));
      } finally {
        setBusy(false);
      }
    },
  });

  async function pickFile() {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      title: "选择私钥文件",
    });
    if (typeof selected === "string") {
      form.setFieldValue("sourcePath", selected);
      if (!form.getFieldValue("label")) {
        const name = selected.split(/[\\/]/).pop() ?? "key";
        form.setFieldValue("label", name);
      }
    }
  }

  async function remove(id: string, name: string) {
    try {
      await deleteKey(id);
      toast.success(`已删除 ${name}`);
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>密钥管理</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg border border-border p-3">
          <FieldGroup>
            <form.Field name="label">
              {(field) => {
                const error = firstFormError(field.state.meta.errors);
                return (
                  <UiField data-invalid={!!error}>
                    <FieldLabel htmlFor="key-label">名称</FieldLabel>
                    <Input
                      id="key-label"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="id_ed25519"
                      aria-invalid={!!error}
                    />
                    {error ? <FieldDescription>{error}</FieldDescription> : null}
                  </UiField>
                );
              }}
            </form.Field>
            <form.Field name="sourcePath">
              {(field) => {
                const error = firstFormError(field.state.meta.errors);
                return (
                  <UiField data-invalid={!!error}>
                    <FieldLabel>私钥文件</FieldLabel>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={field.state.value}
                        placeholder="未选择"
                        className="flex-1"
                        aria-invalid={!!error}
                      />
                      <Button variant="outline" onClick={pickFile}>
                        <Upload data-icon="inline-start" /> 选择
                      </Button>
                    </div>
                    {error ? <FieldDescription>{error}</FieldDescription> : null}
                  </UiField>
                );
              }}
            </form.Field>
            <form.Field name="hasPassphrase">
              {(field) => (
                <UiField orientation="horizontal">
                  <Checkbox
                    id="key-has-passphrase"
                    checked={field.state.value}
                    onCheckedChange={(checked) => field.handleChange(checked === true)}
                  />
                  <FieldLabel htmlFor="key-has-passphrase">
                    该私钥有口令保护（连接时输入）
                  </FieldLabel>
                </UiField>
              )}
            </form.Field>
            <Button onClick={() => void form.handleSubmit()} disabled={busy}>
              {busy ? "导入中…" : "导入密钥"}
            </Button>
          </FieldGroup>
        </div>

        <Separator />

        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            已导入 ({keys.length})
          </p>
          {keys.length === 0 ? (
            <Empty className="py-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRound />
                </EmptyMedia>
                <EmptyTitle>暂无密钥</EmptyTitle>
                <EmptyDescription>导入私钥后可在主机中选用。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-1">
              {keys.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5"
                >
                  <KeyRound className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{k.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {k.hasPassphrase ? "口令保护" : "无口令"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => remove(k.id, k.label)}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
