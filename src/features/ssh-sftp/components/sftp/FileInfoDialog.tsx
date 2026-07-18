import { LoaderCircle } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type {
  InfoState,
} from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";
import {
  entryType,
  formatInfoSize,
  formatInfoTime,
  formatMode,
  formatOwner,
  parentPath,
} from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";
import { cn } from "~/lib/utils";

interface FileInfoDialogProps {
  info: InfoState;
  onOpenChange: (open: boolean) => void;
}

export default function FileInfoDialog({
  info,
  onOpenChange,
}: FileInfoDialogProps) {
  return (
    <Dialog open={!!info} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>简介</Trans>
          </DialogTitle>
          <DialogDescription className="truncate">
            {info?.details?.name ?? info?.entry.name ?? ""}
          </DialogDescription>
        </DialogHeader>
        {info ? (
          <FileInfoDetails
            entry={info.entry}
            details={info.details}
            loading={info.loading}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FileInfoDetails({
  entry,
  details,
  loading,
}: NonNullable<InfoState>) {
  const { t } = useLingui();
  const source = details ?? entry;

  return (
    <div className="flex flex-col gap-3">
      {loading ? (
        <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin" />
          <Trans>正在读取最新信息…</Trans>
        </div>
      ) : null}
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <InfoItem label={t`名称`} value={source.name} />
        <InfoItem label={t`种类`} value={entryType(source)} />
        <InfoItem label={t`大小`} value={formatInfoSize(source)} />
        <InfoItem label={t`位置`} value={parentPath(source.path)} mono />
        <InfoItem label={t`完整路径`} value={source.path} mono />
        <InfoItem label={t`创建时间`} value={formatInfoTime(details?.createdAt)} />
        <InfoItem label={t`修改时间`} value={formatInfoTime(source.mtime)} />
        <InfoItem label={t`访问时间`} value={formatInfoTime(details?.atime)} />
        <InfoItem label={t`权限`} value={formatMode(source.mode)} />
        {details ? <InfoItem label={t`所有者`} value={formatOwner(details)} /> : null}
      </dl>
    </div>
  );
}

function InfoItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 break-words text-foreground",
          mono && "break-all font-mono text-xs",
        )}
      >
        {value}
      </dd>
    </>
  );
}
