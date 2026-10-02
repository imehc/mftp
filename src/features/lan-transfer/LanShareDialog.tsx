import { useEffect } from "react";
import { useForm } from "@tanstack/react-form";
import { Trans, useLingui } from "@lingui/react/macro";
import { baseName, pickDirectoryNative } from "~/lib/files";
import { toast } from "sonner";
import { describeError } from "~/lib/errors";
import { FolderOpen } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Field as UiField,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { DialogLayoutHeader } from "~/components/ui/dialog-layout";
import { firstFormError } from "~/lib/form-errors";
import {
  createLanSharedDirSchema,
  lanSharedDirFormValuesToInput,
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
  const { t } = useLingui();
  const form = useForm({
    defaultValues: emptyShareFormValues,
    validators: {
      onSubmit: createLanSharedDirSchema(t),
    },
    onSubmit: async ({ value }) => {
      await onAdd(lanSharedDirFormValuesToInput(value));
    },
  });
  useEffect(() => {
    if (dialogOpen) form.reset(emptyShareFormValues);
  }, [dialogOpen, form]);
  async function chooseShareDir() {
    try {
      const selected = await pickDirectoryNative(t`选择共享目录`);
      if (!selected) return;
      form.setFieldValue("path", selected);
      if (!form.getFieldValue("name").trim())
        form.setFieldValue("name", baseName(selected));
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="ui-density-adaptive max-w-lg"
        showCloseButton={false}
      >
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            <Trans>添加共享目录</Trans>
          </DialogTitle>
        </DialogLayoutHeader>
        <FieldGroup density="compact">
          <form.Field name="name">
            {(field) => {
              const error = firstFormError(field.state.meta.errors);
              return (
                <UiField data-invalid={!!error}>
                  <FieldLabel htmlFor="lan-share-name">
                    <Trans>名称</Trans>
                  </FieldLabel>
                  <Input
                    id="lan-share-name"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={t`共享目录`}
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
                  <FieldLabel htmlFor="lan-share-path">
                    <Trans>本地目录</Trans>
                  </FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="lan-share-path"
                      readOnly
                      value={field.state.value}
                      placeholder={t`未选择`}
                      className="flex-1"
                      aria-invalid={!!error}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={chooseShareDir}
                    >
                      <FolderOpen data-icon="inline-start" />
                      <Trans>选择</Trans>
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
            <Trans>取消</Trans>
          </Button>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button
                onClick={() => void form.handleSubmit()}
                disabled={busy || isSubmitting}
              >
                <Trans>添加</Trans>
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
