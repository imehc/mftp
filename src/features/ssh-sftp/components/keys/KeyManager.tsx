import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { KeyRound, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Field as UiField,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  createKeyImportSchema,
  emptyKeyImportFormValues,
} from "~/features/ssh-sftp/components/keys/KeyManager.schema";
import { describeError } from "~/lib/errors";
import { baseName, pickFilePathNative } from "~/lib/files";
import { firstFormError } from "~/lib/form-errors";
import { useHostsStore } from "~/store/hosts";
import type { SshKey } from "~/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function KeyManager({ open, onOpenChange }: Props) {
  const { t } = useLingui();
  const keys = useHostsStore((s) => s.keys);
  const importKey = useHostsStore((s) => s.importKey);
  const deleteKey = useHostsStore((s) => s.deleteKey);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SshKey | null>(null);
  const pendingLabel = pendingDelete?.label ?? "";
  const form = useForm({
    defaultValues: emptyKeyImportFormValues,
    validators: {
      onSubmit: createKeyImportSchema(t),
    },
    onSubmit: async ({ value }) => {
      setBusy(true);
      try {
        await importKey(
          value.label.trim(),
          value.sourcePath.trim(),
          value.hasPassphrase,
        );
        const trimValue = value.label.trim();
        toast.success(t`已导入密钥 ${trimValue}`);
        form.reset(emptyKeyImportFormValues);
      } catch (e) {
        toast.error(describeError(e));
      } finally {
        setBusy(false);
      }
    },
  });

  async function pickFile() {
    try {
      const selected = await pickFilePathNative({
        title: t`选择私钥文件`,
        filterName: t`私钥文件`,
        extensions: ["*"],
        allowMobile: true,
      });
      if (typeof selected === "string") {
        form.setFieldValue("sourcePath", selected);
        if (!form.getFieldValue("label"))
          form.setFieldValue("label", baseName(selected));
      }
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  async function remove(id: string, name: string) {
    try {
      await deleteKey(id);
      toast.success(t`已删除 ${name}`);
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogLayoutContent
        placement="responsive-page"
        className="md:max-w-lg"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            <Trans>密钥管理</Trans>
          </DialogTitle>
        </DialogLayoutHeader>
        <DialogLayoutBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 rounded-lg border p-3">
            {keys.length ? (
              <p className="text-muted-foreground text-xs font-medium">
                <Plural
                  value={{
                    importedKeyCount: keys.length,
                  }}
                  one="已导入 # 个密钥"
                  other="已导入 # 个密钥"
                />
              </p>
            ) : null}
            {keys.length === 0 ? (
              <Empty className="py-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <KeyRound />
                  </EmptyMedia>
                  <EmptyTitle>
                    <Trans>暂无密钥</Trans>
                  </EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="flex flex-col gap-1">
                {keys.map((k) => (
                  <li
                    key={k.id}
                    className="border-border flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
                  >
                    <KeyRound className="text-muted-foreground size-4" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{k.label}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {k.hasPassphrase ? t`口令保护` : t`无口令`}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t`删除`}
                      onClick={() => setPendingDelete(k)}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-border rounded-lg border p-3">
            <FieldGroup>
              <form.Field name="label">
                {(field) => {
                  const error = firstFormError(field.state.meta.errors);
                  return (
                    <UiField data-invalid={!!error}>
                      <FieldLabel htmlFor="key-label">
                        <Trans>名称</Trans>
                      </FieldLabel>
                      <Input
                        id="key-label"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="id_ed25519"
                        aria-invalid={!!error}
                        aria-describedby={error ? "key-label-error" : undefined}
                      />
                      {error ? (
                        <FieldError id="key-label-error">{error}</FieldError>
                      ) : null}
                    </UiField>
                  );
                }}
              </form.Field>
              <form.Field name="sourcePath">
                {(field) => {
                  const error = firstFormError(field.state.meta.errors);
                  return (
                    <UiField data-invalid={!!error}>
                      <FieldLabel htmlFor="key-source-path">
                        <Trans>私钥文件</Trans>
                      </FieldLabel>
                      <div className="flex gap-2">
                        <Input
                          id="key-source-path"
                          readOnly
                          value={field.state.value}
                          placeholder={t`未选择`}
                          className="flex-1"
                          aria-invalid={!!error}
                          aria-describedby={
                            error ? "key-source-path-error" : undefined
                          }
                        />
                        <Button variant="outline" onClick={pickFile}>
                          <Upload data-icon="inline-start" />{" "}
                          <Trans>选择</Trans>
                        </Button>
                      </div>
                      {error ? (
                        <FieldError id="key-source-path-error">
                          {error}
                        </FieldError>
                      ) : null}
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
                      onCheckedChange={(checked) =>
                        field.handleChange(checked === true)
                      }
                    />
                    <FieldLabel htmlFor="key-has-passphrase">
                      <Trans comment="导入密钥表单：勾选表示该私钥需要口令">
                        该私钥有口令
                      </Trans>
                    </FieldLabel>
                  </UiField>
                )}
              </form.Field>
              <Button
                fullWidth
                onClick={() => void form.handleSubmit()}
                disabled={busy}
              >
                {busy ? t`导入中…` : t`导入密钥`}
              </Button>
            </FieldGroup>
          </div>
        </DialogLayoutBody>
      </DialogLayoutContent>
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(nextOpen) => !nextOpen && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>删除密钥</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t`删除密钥“${pendingLabel}”？使用该密钥的主机将无法连接，需重新导入。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) {
                  void remove(pendingDelete.id, pendingDelete.label);
                }
              }}
            >
              <Trans>删除</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
