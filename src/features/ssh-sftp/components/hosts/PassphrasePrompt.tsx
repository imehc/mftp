import { useEffect } from "react";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import type { Host } from "~/types";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { firstFormError } from "~/lib/form-errors";

interface Props {
  /** The host awaiting a passphrase, or null when hidden. */
  host: Host | null;
  onClose: () => void;
  onSubmit: (passphrase: string) => void;
}

export default function PassphrasePrompt({ host, onClose, onSubmit }: Props) {
  const form = useForm({
    defaultValues: { passphrase: "" },
    validators: {
      onSubmit: z.object({
        passphrase: z.string().min(1, "请输入口令"),
      }),
    },
    onSubmit: ({ value }) => {
      onSubmit(value.passphrase);
    },
  });

  useEffect(() => {
    if (host) form.reset({ passphrase: "" });
  }, [form, host]);

  return (
    <Dialog open={!!host} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>输入密钥口令</DialogTitle>
        </DialogHeader>
        <form
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-3"
        >
          <form.Field name="passphrase">
            {(field) => {
              const error = firstFormError(field.state.meta.errors);
              return (
                <Field data-invalid={!!error}>
                  <FieldLabel htmlFor="passphrase">
                    {host?.label} 的私钥口令
                  </FieldLabel>
                  <Input
                    id="passphrase"
                    type="password"
                    autoFocus
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="passphrase"
                    aria-invalid={!!error}
                  />
                  {error ? <FieldDescription>{error}</FieldDescription> : null}
                </Field>
              );
            }}
          </form.Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit">连接</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
