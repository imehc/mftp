import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/checkbox";
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

interface TaskDialogsProps {
  /** 磁力链接弹窗的内容；null 表示不显示。 */
  magnetText: string | null;
  onCloseMagnet: () => void;
  onCopyMagnet: (text: string) => void;
  /** 待确认删除的标题；null 表示不显示。 */
  pendingDeleteLabel: string | null;
  /** 预览任务没有可删的本地文件，不显示该勾选项。 */
  showDeleteFiles: boolean;
  deleteFiles: boolean;
  onDeleteFilesChange: (value: boolean) => void;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
  /** 待确认转存的标题；null 表示不显示。 */
  pendingSaveLabel: string | null;
  onCloseSave: () => void;
  onConfirmSave: () => void;
}

/** 任务列表用到的三个独立弹窗：磁力链接、删除确认、转存确认。 */
export default function TaskDialogs({
  magnetText,
  onCloseMagnet,
  onCopyMagnet,
  pendingDeleteLabel,
  showDeleteFiles,
  deleteFiles,
  onDeleteFilesChange,
  onCloseDelete,
  onConfirmDelete,
  pendingSaveLabel,
  onCloseSave,
  onConfirmSave,
}: TaskDialogsProps) {
  const { t } = useLingui();
  return (
    <>
      <Dialog
        open={magnetText !== null}
        onOpenChange={(open) => !open && onCloseMagnet()}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <Trans>磁力链接</Trans>
            </DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={magnetText ?? ""} />
            <Button
              variant="outline"
              onClick={() => onCopyMagnet(magnetText ?? "")}
            >
              <Trans>复制</Trans>
            </Button>
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
              <Trans>删除后无法恢复。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {showDeleteFiles ? (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={deleteFiles}
                onCheckedChange={(value) => onDeleteFilesChange(value === true)}
              />
              <Trans>删除文件</Trans>
            </label>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t`取消`}</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDelete}>
              {t`删除`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingSaveLabel !== null}
        onOpenChange={(open) => !open && onCloseSave()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingSaveLabel ? t`下载 ${pendingSaveLabel}` : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>转存完成后会从缓存中移除。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t`取消`}</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmSave}>
              {t`下载`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
