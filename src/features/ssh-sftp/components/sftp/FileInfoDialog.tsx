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
  formatOwner,
  parentPath,
  parseFileMode,
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
            <Trans>文件信息</Trans>
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
  const permissions = parseFileMode(source.mode);

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
        <dt className="text-muted-foreground">{t`权限`}</dt>
        <dd className="min-w-0">
          {permissions ? (
            <PermissionDetails permissions={permissions} />
          ) : (
            "—"
          )}
        </dd>
        {details ? <InfoItem label={t`所有者`} value={formatOwner(details)} /> : null}
      </dl>
    </div>
  );
}

function PermissionDetails({
  permissions,
}: {
  permissions: NonNullable<ReturnType<typeof parseFileMode>>;
}) {
  const { i18n, t } = useLingui();
  const specialPermissions = [
    permissions.setUserId ? t`设置用户 ID` : null,
    permissions.setGroupId ? t`设置用户组 ID` : null,
    permissions.sticky ? t`粘滞位` : null,
  ].filter((value): value is string => value != null);

  const accessLabel = (bits: number) => {
    switch (bits) {
      case 0:
        return t`无权限`;
      case 1:
        return t`执行`;
      case 2:
        return t`写入`;
      case 3:
        return t`写入、执行`;
      case 4:
        return t`读取`;
      case 5:
        return t`读取、执行`;
      case 6:
        return t`读取、写入`;
      default:
        return t`读取、写入、执行`;
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-muted/60 px-2.5 py-2 text-xs">
      <PermissionRow label={t`所有者`} value={accessLabel(permissions.owner)} />
      <PermissionRow label={t`用户组`} value={accessLabel(permissions.group)} />
      <PermissionRow label={t`其他用户`} value={accessLabel(permissions.others)} />
      {specialPermissions.length > 0 ? (
        <PermissionRow
          label={t`特殊权限`}
          value={specialPermissions.join(
            i18n.locale.startsWith("zh") ? "、" : ", ",
          )}
        />
      ) : null}
      <PermissionRow
        label={t`原始值`}
        value={permissions.raw}
        mono
      />
    </div>
  );
}

function PermissionRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("break-words text-foreground", mono && "font-mono")}>
        {value}
      </span>
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
