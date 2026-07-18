import { useEffect } from "react";
import { useForm } from "@tanstack/react-form";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Field as UiField,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { firstFormError } from "~/lib/form-errors";
import {
  lanSharedDirFormValuesToInput,
  lanSharedDirSchema,
  type LanSharedDirFormValues,
} from "~/features/lan-transfer/lanTransferForms.schema";
import type { LanSharedDirInput } from "~/types";

interface LanShareDialogProps {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (input: LanSharedDirInput) => Promise<void>;
}

const emptyShareFormValues: LanSharedDirFormValues = {
  name: "",
  path: "",
};

export default function LanShareDialog({
  open: dialogOpen,
  busy,
  onOpenChange,
  onAdd,
}: LanShareDialogProps) {
  const form = useForm({
    defaultValues: emptyShareFormValues,
    validators: {
      onSubmit: lanSharedDirSchema,
    },
    onSubmit: async ({ value }) => {
      await onAdd(lanSharedDirFormValuesToInput(value));
    },
  });

  useEffect(() => {
    if (dialogOpen) form.reset(emptyShareFormValues);
  }, [dialogOpen, form]);

  async function chooseShareDir() {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "选择共享目录",
    });
    if (typeof selected !== "string") return;
    form.setFieldValue("path", selected);
    if (!form.getFieldValue("name").trim()) {
      const parts = selected.split(/[\\/]/).filter(Boolean);
      form.setFieldValue("name", parts[parts.length - 1] ?? "共享目录");
    }
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>添加共享目录</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <form.Field name="name">
            {(field) => {
              const error = firstFormError(field.state.meta.errors);
              return (
                <UiField data-invalid={!!error}>
                  <FieldLabel htmlFor="lan-share-name">名称</FieldLabel>
                  <Input
                    id="lan-share-name"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="共享目录"
                    aria-invalid={!!error}
                  />
                  {error ? <FieldDescription>{error}</FieldDescription> : null}
                </UiField>
              );
            }}
          </form.Field>
          <form.Field name="path">
            {(field) => {
              const error = firstFormError(field.state.meta.errors);
              return (
                <UiField data-invalid={!!error}>
                  <FieldLabel>本地目录</FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={field.state.value}
                      placeholder="未选择"
                      className="flex-1"
                      aria-invalid={!!error}
                    />
                    <Button type="button" variant="outline" onClick={chooseShareDir}>
                      <FolderOpen data-icon="inline-start" />
                      选择
                    </Button>
                  </div>
                  {error ? <FieldDescription>{error}</FieldDescription> : null}
                </UiField>
              );
            }}
          </form.Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button
                onClick={() => void form.handleSubmit()}
                disabled={busy || isSubmitting}
              >
                添加
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
