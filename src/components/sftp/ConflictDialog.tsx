import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "~/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";

export type ConflictMode = "incoming" | "existing";

interface Props {
  open: boolean;
  /** The conflicting name that already exists remotely. */
  name: string;
  /** Wording for the incoming item, e.g. "上传的文件夹" / "解压出的文件夹". */
  incomingLabel: string;
  onOpenChange: (open: boolean) => void;
  onResolve: (mode: ConflictMode, newName: string) => void;
}

/**
 * Resolve a remote name conflict: either rename the incoming folder, or rename
 * the existing remote folder. The new name must differ from the conflicting
 * name, otherwise the conflict persists and confirm stays disabled.
 */
export default function ConflictDialog({
  open,
  name,
  incomingLabel,
  onOpenChange,
  onResolve,
}: Props) {
  const [mode, setMode] = useState<ConflictMode>("incoming");
  const [value, setValue] = useState(name);

  useEffect(() => {
    if (open) {
      setMode("incoming");
      setValue(name);
    }
  }, [open, name]);

  const trimmed = value.trim();
  // Still conflicting if empty or unchanged; also block path separators.
  const invalid =
    trimmed === "" || trimmed === name || /[\\/]/.test(trimmed);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>目标已存在同名文件夹</DialogTitle>
          <DialogDescription>
            远端已存在 “{name}”。请选择如何处理后继续。
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) onResolve(mode, trimmed);
          }}
          className="flex flex-col gap-3"
        >
          <Field>
            <FieldLabel>处理方式</FieldLabel>
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as ConflictMode)}
              variant="outline"
              className="w-full"
            >
              <ToggleGroupItem value="incoming" className="flex-1">
                重命名{incomingLabel}
              </ToggleGroupItem>
              <ToggleGroupItem value="existing" className="flex-1">
                重命名远端已有
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <Field>
            <FieldLabel htmlFor="conflict-name">
              {mode === "incoming" ? `${incomingLabel}新名称` : "远端已有新名称"}
            </FieldLabel>
            <Input
              id="conflict-name"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={invalid}
            />
            <FieldDescription className={invalid ? "text-destructive" : ""}>
              {trimmed === name
                ? "名称与现有相同，仍会冲突。"
                : /[\\/]/.test(trimmed)
                  ? "名称不能包含斜杠。"
                  : "改名后不再冲突即可继续。"}
            </FieldDescription>
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={invalid}>
              确认
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
