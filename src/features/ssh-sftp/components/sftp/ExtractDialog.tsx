import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useForm } from "@tanstack/react-form";
import { Trans, useLingui } from "@lingui/react/macro";
import { z } from "zod";
import { FolderOpen } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { FieldDescription } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { firstFormError } from "~/lib/form-errors";
import type { ExtractState } from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";

interface ExtractDialogProps {
  extractTarget: ExtractState;
  directoryPickerOpen: boolean;
  setExtractTarget: Dispatch<SetStateAction<ExtractState>>;
  chooseExtractParent: () => void;
  confirmExtract: () => void;
}

export default function ExtractDialog({
  extractTarget,
  directoryPickerOpen,
  setExtractTarget,
  chooseExtractParent,
  confirmExtract,
}: ExtractDialogProps) {
  const { t } = useLingui();
  const form = useForm({
    defaultValues: { outName: "" },
    validators: {
      onSubmit: z.object({
        outName: z.string().trim().min(1, t`名称不能为空`).refine(
          (value) => !/[\\/]/.test(value),
          t`名称不能包含斜杠`,
        ),
      }),
    },
    onSubmit: () => {
      confirmExtract();
    },
  });

  useEffect(() => {
    if (extractTarget) form.reset({ outName: extractTarget.outName });
  }, [extractTarget, form]);

  return (
    <Dialog
      open={!!extractTarget && !directoryPickerOpen}
      onOpenChange={(open) => !open && !directoryPickerOpen && setExtractTarget(null)}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>解压</Trans>
          </DialogTitle>
          <DialogDescription className="truncate">
            {extractTarget?.entry.name ?? ""}
          </DialogDescription>
        </DialogHeader>
        {extractTarget ? (
          <FieldGroup className="gap-3">
            <form.Field name="outName">
              {(field) => {
                const error = firstFormError(field.state.meta.errors);
                return (
                  <Field data-invalid={!!error}>
                    <FieldLabel>
                      <Trans>文件夹名称</Trans>
                    </FieldLabel>
                    <Input
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                        setExtractTarget((current) =>
                          current ? { ...current, outName: event.target.value } : current,
                        );
                      }}
                      aria-invalid={!!error}
                    />
                    {error ? <FieldDescription>{error}</FieldDescription> : null}
                  </Field>
                );
              }}
            </form.Field>
            <Field>
              <FieldLabel>
                <Trans>位置</Trans>
              </FieldLabel>
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
                  {extractTarget.remoteParent}
                </div>
                <Button type="button" variant="outline" onClick={chooseExtractParent}>
                  <FolderOpen data-icon="inline-start" /> <Trans>选择</Trans>
                </Button>
              </div>
            </Field>
          </FieldGroup>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setExtractTarget(null)}>
            <Trans>取消</Trans>
          </Button>
          <Button onClick={() => void form.handleSubmit()}>
            <Trans>解压</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
