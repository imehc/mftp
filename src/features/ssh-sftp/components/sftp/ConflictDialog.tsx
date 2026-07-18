import { useEffect, useMemo } from "react";
import { useForm } from "@tanstack/react-form";
import { Trans, useLingui } from "@lingui/react/macro";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { firstFormError } from "~/lib/form-errors";

export interface ConflictResolution {
  incomingName: string;
  existingName: string;
}

interface Props {
  open: boolean;
  /** The conflicting name that already exists remotely. */
  name: string;
  /** Wording for the incoming item, e.g. "上传的文件夹" / "要移动的文件". */
  incomingLabel: string;
  initialIncomingName?: string;
  initialExistingName?: string;
  onOpenChange: (open: boolean) => void;
  onResolve: (resolution: ConflictResolution) => void;
}

/**
 * Resolve a remote name conflict by optionally renaming both the incoming item
 * and the existing remote item before continuing.
 */
export default function ConflictDialog({
  open,
  name,
  incomingLabel,
  initialIncomingName,
  initialExistingName,
  onOpenChange,
  onResolve,
}: Props) {
  const { t } = useLingui();
  const schema = useMemo(
    () =>
      z
        .object({
          incomingName: z.string(),
          existingName: z.string(),
        })
        .superRefine((value, ctx) => {
          const incomingName = value.incomingName.trim();
          const existingName = value.existingName.trim();
          const incomingInvalid = incomingName === "" || /[\\/]/.test(incomingName);
          const existingInvalid = existingName === "" || /[\\/]/.test(existingName);
          if (incomingInvalid) {
            ctx.addIssue({
              code: "custom",
              path: ["incomingName"],
              message: t`名称不能为空，且不能包含斜杠。`,
            });
          }
          if (existingInvalid) {
            ctx.addIssue({
              code: "custom",
              path: ["existingName"],
              message: t`名称不能为空，且不能包含斜杠。`,
            });
          }
          if (incomingName !== "" && incomingName === existingName) {
            ctx.addIssue({
              code: "custom",
              path: ["existingName"],
              message: t`两个名称不能相同。`,
            });
          }
          if (incomingName === name && existingName === name) {
            ctx.addIssue({
              code: "custom",
              path: ["existingName"],
              message: t`至少修改其中一个名称。`,
            });
          }
        }),
    [name, t],
  );

  const form = useForm({
    defaultValues: {
      incomingName: name,
      existingName: name,
    },
    validators: {
      onSubmit: schema,
    },
    onSubmit: ({ value }) => {
      onResolve({
        incomingName: value.incomingName.trim(),
        existingName: value.existingName.trim(),
      });
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        incomingName: initialIncomingName ?? name,
        existingName: initialExistingName ?? name,
      });
    }
  }, [form, open, name, initialIncomingName, initialExistingName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>目标已存在同名项目</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>远端已存在 “{name}”。修改要继续操作的名称，或先重命名远端已有项目。</Trans>
          </DialogDescription>
        </DialogHeader>

        <form
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field name="incomingName">
              {(field) => {
                const error = firstFormError(field.state.meta.errors);
                return (
                  <Field data-invalid={!!error}>
                    <FieldLabel htmlFor="conflict-incoming-name">
                      <Trans>{incomingLabel}名称</Trans>
                    </FieldLabel>
                    <Input
                      id="conflict-incoming-name"
                      autoFocus
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={!!error}
                    />
                  </Field>
                );
              }}
            </form.Field>

            <form.Field name="existingName">
              {(field) => {
                const error = firstFormError(field.state.meta.errors);
                return (
                  <Field data-invalid={!!error}>
                    <FieldLabel htmlFor="conflict-existing-name">
                      <Trans>远端已有名称</Trans>
                    </FieldLabel>
                    <Input
                      id="conflict-existing-name"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={!!error}
                    />
                    <form.Subscribe selector={(state) => state.values}>
                      {(values) => {
                        const incomingName = values.incomingName.trim();
                        const existingName = values.existingName.trim();
                        const incomingInvalid = incomingName === "" || /[\\/]/.test(incomingName);
                        const existingInvalid = existingName === "" || /[\\/]/.test(existingName);
                        const unchanged = incomingName === name && existingName === name;
                        const duplicated = incomingName !== "" && incomingName === existingName;
                        const invalid = incomingInvalid || existingInvalid || unchanged || duplicated;
                        return (
                          <FieldDescription className={invalid ? "text-destructive" : ""}>
                            {unchanged
                              ? t`至少修改其中一个名称。`
                              : duplicated
                                ? t`两个名称不能相同。`
                                : incomingInvalid || existingInvalid
                                  ? t`名称不能为空，且不能包含斜杠。`
                                  : t`确认后会按上面的名称继续。`}
                          </FieldDescription>
                        );
                      }}
                    </form.Subscribe>
                  </Field>
                );
              }}
            </form.Field>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                <Trans>取消</Trans>
              </Button>
              <form.Subscribe selector={(state) => state.values}>
                {(values) => {
                  const incomingName = values.incomingName.trim();
                  const existingName = values.existingName.trim();
                  const incomingInvalid = incomingName === "" || /[\\/]/.test(incomingName);
                  const existingInvalid = existingName === "" || /[\\/]/.test(existingName);
                  const unchanged = incomingName === name && existingName === name;
                  const duplicated = incomingName !== "" && incomingName === existingName;
                  const invalid = incomingInvalid || existingInvalid || unchanged || duplicated;
                  return (
                    <Button type="submit" disabled={invalid}>
                      <Trans>确认</Trans>
                    </Button>
                  );
                }}
              </form.Subscribe>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
