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
import { Trans, useLingui } from "@lingui/react/macro";
import type { SftpEntry } from "~/types";
interface DeleteConfirmDialogProps {
  target: SftpEntry | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}
export default function DeleteConfirmDialog({
  target,
  onOpenChange,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const { t } = useLingui();
  const value = target?.name;
  return (
    <AlertDialog open={!!target} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {target?.isDir ? t`删除文件夹` : t`删除文件`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans>确定删除 “{value}”？</Trans>
            {target?.isDir ? t`该文件夹及其全部内容将被永久删除。` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Trans>取消</Trans>
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            <Trans>删除</Trans>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
