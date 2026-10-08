import { useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import {
  Download,
  File as FileIcon,
  FileArchive,
  Folder,
  FolderInput,
  FolderOpen,
  Info,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  entryType,
  formatMtime,
  formatSize,
  isArchive,
} from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";
import { TOUCH_TARGET_CLASS } from "~/lib/touch";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import type { SftpEntry } from "~/types";

import type { SftpAction } from "./sftp-actions";
import SftpActionsMobile from "./SftpActions.mobile";

interface RowProps {
  entry: SftpEntry;
  loading: boolean;
  disabled: boolean;
  onEnter: (path: string) => void;
  onInfo: (entry: SftpEntry) => void;
  onDownload: (entry: SftpEntry) => void;
  onExtract: (entry: SftpEntry) => void;
  onMove: (entry: SftpEntry) => void;
  onRename: (entry: SftpEntry) => void;
  onDelete: (entry: SftpEntry) => void;
}

const SftpRow = function SftpRow({
  entry,
  loading,
  disabled,
  onEnter,
  onInfo,
  onDownload,
  onExtract,
  onMove,
  onRename,
  onDelete,
}: RowProps) {
  const { t } = useLingui();
  const compact = !useDesktopLayout();
  const canExtract = !entry.isDir && isArchive(entry.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const actions: SftpAction[] = [
    { label: t`下载`, icon: Download, run: () => onDownload(entry) },
    { label: t`文件信息`, icon: Info, run: () => onInfo(entry) },
    ...(canExtract
      ? [{ label: t`解压`, icon: FolderOpen, run: () => onExtract(entry) }]
      : []),
    { label: t`移动`, icon: FolderInput, run: () => onMove(entry) },
    { label: t`重命名`, icon: Pencil, run: () => onRename(entry) },
    {
      label: t`删除`,
      icon: Trash2,
      run: () => onDelete(entry),
      destructive: true,
    },
  ];
  return (
    <div
      className={cn(
        "group border-border/40 hover:bg-muted/50 grid grid-cols-[var(--sftp-list-columns)] items-center border-b px-3 py-1.5 text-sm max-md:min-h-16 max-md:grid-cols-[minmax(0,1fr)_auto]",
        menuOpen && "bg-muted/50",
      )}
    >
      <button
        className="flex min-w-0 items-center gap-2 px-2 text-left"
        onClick={() => (entry.isDir ? onEnter(entry.path) : onInfo(entry))}
        disabled={disabled}
      >
        {loading ? (
          <LoaderCircle className="text-muted-foreground size-4 shrink-0 animate-spin" />
        ) : entry.isDir ? (
          <Folder className="text-primary size-4 shrink-0" />
        ) : canExtract ? (
          <FileArchive className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <FileIcon className="text-muted-foreground size-4 shrink-0" />
        )}
        <span className="min-w-0">
          <span className="block truncate">{entry.name}</span>
          <span className="text-muted-foreground mt-1 block truncate text-xs md:hidden">
            {entry.isDir ? t`文件夹` : formatSize(entry.size)} ·{" "}
            {formatMtime(entry.mtime)}
          </span>
        </span>
      </button>
      <span className="text-muted-foreground hidden truncate px-2 text-left text-xs md:block">
        {formatMtime(entry.mtime)}
      </span>
      <span className="text-muted-foreground hidden truncate px-2 text-left text-xs md:block">
        {entryType(entry)}
      </span>
      <span className="text-muted-foreground hidden truncate px-2 text-left text-xs md:block">
        {entry.isDir ? "—" : formatSize(entry.size)}
      </span>
      <div className="flex min-w-0 justify-end px-1">
        <>
          {compact ? (
            <SftpActionsMobile
              name={entry.name}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              actions={actions}
            />
          ) : (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title={t`更多`}
                  aria-label={t`更多文件操作`}
                  className={TOUCH_TARGET_CLASS}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="ui-density-adaptive">
                <DropdownMenuGroup>
                  {actions.map(({ label, icon: Icon, run, destructive }) => (
                    <DropdownMenuItem
                      key={label}
                      onSelect={run}
                      variant={destructive ? "destructive" : "default"}
                    >
                      <Icon />
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </>
      </div>
    </div>
  );
};

export default SftpRow;
