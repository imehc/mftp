import { useEffect, useState } from "react";
import type { Host } from "~/types";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Field, FieldLabel } from "~/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

interface Props {
  /** The host awaiting a passphrase, or null when hidden. */
  host: Host | null;
  onClose: () => void;
  onSubmit: (passphrase: string) => void;
}

export default function PassphrasePrompt({ host, onClose, onSubmit }: Props) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (host) setValue("");
  }, [host]);

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
            onSubmit(value);
          }}
          className="flex flex-col gap-3"
        >
          <Field>
            <FieldLabel htmlFor="passphrase">
              {host?.label} 的私钥口令
            </FieldLabel>
            <Input
              id="passphrase"
              type="password"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="passphrase"
            />
          </Field>
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
