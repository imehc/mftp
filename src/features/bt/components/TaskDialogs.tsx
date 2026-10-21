import { Trans, useLingui } from "@lingui/react/macro";
import { toast } from "sonner";

import { CopyButton } from "~/components/CopyButton";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { describeError } from "~/lib/errors";

interface TaskDialogsProps {
  /** 磁力链接弹窗的内容；null 表示不显示。 */
  magnetText: string | null;
  onCloseMagnet: () => void;
  /** 待确认删除的标题；null 表示不显示。 */
  pendingDeleteLabel: string | null;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
  /** 待确认取消的标题；null 表示不显示。 */
  pendingCancelLabel: string | null;
  onCloseCancel: () => void;
  onConfirmCancel: () => void;
}

/** 任务列表用到的磁力链接、删除与取消确认弹窗。 */
export default function TaskDialogs({
  magnetText,
  onCloseMagnet,
  pendingDeleteLabel,
  onCloseDelete,
  onConfirmDelete,
  pendingCancelLabel,
  onCloseCancel,
  onConfirmCancel,
}: TaskDialogsProps) {
  const { t } = useLingui();
  return (
    <>
      <Dialog
        open={magnetText !== null}
        onOpenChange={(open) => !open && onCloseMagnet()}
      >
        <DialogContent className="md:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <Trans>磁力链接</Trans>
            </DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={magnetText ?? ""} />
            <CopyButton
              variant="outline"
              value={magnetText ?? ""}
              showLabel
              label={t`复制`}
              copiedLabel={t`已复制`}
              onError={(error) => toast.error(describeError(error))}
            />
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDeleteLabel !== null}
        onOpenChange={(open) => !open && onCloseDelete()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDeleteLabel ? t`删除 ${pendingDeleteLabel}` : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>任务及应用内下载文件将被删除，操作无法恢复。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t`取消`}</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDelete}>
              {t`删除`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingCancelLabel !== null}
        onOpenChange={(open) => !open && onCloseCancel()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingCancelLabel ? t`取消 ${pendingCancelLabel}` : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                任务会停止，已下载的临时文件将被删除，任务记录仍会保留。
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t`返回`}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onConfirmCancel}>
              {t`取消任务`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
