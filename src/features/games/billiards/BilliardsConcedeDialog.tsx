import { Trans } from "@lingui/react/macro";

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

export function BilliardsConcedeDialog({
  open,
  enabled,
  onOpenChange,
  onConcede,
}: {
  open: boolean;
  enabled: boolean;
  onOpenChange(open: boolean): void;
  onConcede(): void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className="ui-density-adaptive"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document
            .querySelector<HTMLButtonElement>(
              ".billiards-game [data-game-more]",
            )
            ?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            <Trans>认输本局？</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans>本局将结束，对手获胜并保存当前比分。</Trans>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Trans>取消</Trans>
          </AlertDialogCancel>
          <AlertDialogAction disabled={!enabled} onClick={onConcede}>
            <Trans>认输</Trans>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
