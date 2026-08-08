import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Trans } from "@lingui/react/macro";
import { Checkbox } from "~/components/ui/checkbox";
import { formatBytes } from "~/lib/format";

interface RemoveConfirmDialogProps {
  open: boolean;
  count: number;
  bytes: number;
  permanent: boolean;
  busy: boolean;
  onPermanentChange: (permanent: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/**
 * Deletion goes to the Trash by default so a mistake stays recoverable;
 * permanent is an explicit opt-in, re-armed on every open by the caller.
 */
export default function RemoveConfirmDialog({
  open,
  count,
  bytes,
  permanent,
  busy,
  onPermanentChange,
  onOpenChange,
  onConfirm,
}: RemoveConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <Trans>清理 {count} 项</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            {permanent ? (
              <Trans>
                将永久删除 {formatBytes(bytes)}，无法恢复。
              </Trans>
            ) : (
              <Trans>
                将移到废纸篓，可释放 {formatBytes(bytes)}。
              </Trans>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={permanent}
            onCheckedChange={(checked) => onPermanentChange(checked === true)}
          />
          <Trans>直接永久删除，不经废纸篓</Trans>
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Trans>取消</Trans>
          </AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={onConfirm}>
            <Trans>清理</Trans>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
