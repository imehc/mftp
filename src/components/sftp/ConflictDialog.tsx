import { useEffect, useState } from "react";
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
  const [incomingValue, setIncomingValue] = useState(name);
  const [existingValue, setExistingValue] = useState(name);

  useEffect(() => {
    if (open) {
      setIncomingValue(initialIncomingName ?? name);
      setExistingValue(initialExistingName ?? name);
    }
  }, [open, name, initialIncomingName, initialExistingName]);

  const incomingName = incomingValue.trim();
  const existingName = existingValue.trim();
  const incomingInvalid = incomingName === "" || /[\\/]/.test(incomingName);
  const existingInvalid = existingName === "" || /[\\/]/.test(existingName);
  const unchanged = incomingName === name && existingName === name;
  const duplicated = incomingName !== "" && incomingName === existingName;
  const invalid = incomingInvalid || existingInvalid || unchanged || duplicated;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>目标已存在同名项目</DialogTitle>
          <DialogDescription>
            远端已存在 “{name}”。修改要继续操作的名称，或先重命名远端已有项目。
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) onResolve({ incomingName, existingName });
          }}
        >
          <FieldGroup>
            <Field data-invalid={incomingInvalid || duplicated}>
              <FieldLabel htmlFor="conflict-incoming-name">
                {incomingLabel}名称
              </FieldLabel>
              <Input
                id="conflict-incoming-name"
                autoFocus
                value={incomingValue}
                onChange={(e) => setIncomingValue(e.target.value)}
                aria-invalid={incomingInvalid || duplicated}
              />
            </Field>

            <Field data-invalid={existingInvalid || duplicated}>
              <FieldLabel htmlFor="conflict-existing-name">
                远端已有名称
              </FieldLabel>
              <Input
                id="conflict-existing-name"
                value={existingValue}
                onChange={(e) => setExistingValue(e.target.value)}
                aria-invalid={existingInvalid || duplicated}
              />
              <FieldDescription className={invalid ? "text-destructive" : ""}>
                {unchanged
                  ? "至少修改其中一个名称。"
                  : duplicated
                    ? "两个名称不能相同。"
                    : incomingInvalid || existingInvalid
                      ? "名称不能为空，且不能包含斜杠。"
                      : "确认后会按上面的名称继续。"}
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
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
