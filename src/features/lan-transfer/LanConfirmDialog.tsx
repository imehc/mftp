import { Trans } from "@lingui/react/macro";
import type { ComponentProps, ReactNode } from "react";

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

interface Props {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: ReactNode;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCloseAutoFocus?: ComponentProps<
    typeof AlertDialogContent
  >["onCloseAutoFocus"];
}

export default function LanConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onOpenChange,
  onConfirm,
  onCloseAutoFocus,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Trans>取消</Trans>
          </AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
