import { useEffect } from "react";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { FieldDescription } from "~/components/ui/field";
import { firstFormError } from "~/lib/form-errors";

interface Props {
  open: boolean;
  title: string;
  placeholder?: string;
  initialValue?: string;
  confirmText?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (value: string) => void;
}

/** A small single-input dialog used for actions like "new folder" / "rename". */
export default function PromptDialog({
  open,
  title,
  placeholder,
  initialValue = "",
  confirmText = "确定",
  onOpenChange,
  onConfirm,
}: Props) {
  const form = useForm({
    defaultValues: { value: initialValue },
    validators: {
      onSubmit: z.object({
        value: z.string().trim().min(1, "请输入内容"),
      }),
    },
    onSubmit: ({ value }) => {
      onConfirm(value.value.trim());
    },
  });

  useEffect(() => {
    if (open) form.reset({ value: initialValue });
  }, [form, open, initialValue]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-3"
        >
          <form.Field name="value">
            {(field) => {
              const error = firstFormError(field.state.meta.errors);
              return (
                <div className="flex flex-col gap-1.5">
                  <Input
                    autoFocus
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    placeholder={placeholder}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={!!error}
                  />
                  {error ? (
                    <FieldDescription className="text-destructive">
                      {error}
                    </FieldDescription>
                  ) : null}
                </div>
              );
            }}
          </form.Field>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit">{confirmText}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
