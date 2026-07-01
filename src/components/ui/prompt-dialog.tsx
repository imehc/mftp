import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

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
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = value.trim();
            if (v) onConfirm(v);
          }}
          className="flex flex-col gap-3"
        >
          <Input
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
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
