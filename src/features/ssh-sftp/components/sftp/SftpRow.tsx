import { memo, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
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
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { SftpEntry } from "~/types";
import {
  entryType,
  formatMtime,
  formatSize,
  isArchive,
} from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";
import { cn } from "~/lib/utils";

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

const SftpRow = memo(function SftpRow({
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
  const canExtract = !entry.isDir && isArchive(entry.name);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className={cn(
        "group grid grid-cols-[var(--sftp-list-columns)] items-center border-b border-border/40 px-3 py-1.5 text-sm hover:bg-muted/50",
        menuOpen && "bg-muted/50",
      )}
    >
      <button
        className="flex min-w-0 items-center gap-2 px-2 text-left"
        onDoubleClick={() => entry.isDir && onEnter(entry.path)}
        disabled={!entry.isDir || disabled}
      >
        {loading ? (
          <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : entry.isDir ? (
          <Folder className="size-4 shrink-0 text-primary" />
        ) : canExtract ? (
          <FileArchive className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <FileIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("truncate", entry.isDir && "cursor-pointer")}>
          {entry.name}
        </span>
      </button>
      <span className="truncate px-2 text-left text-xs text-muted-foreground">
        {formatMtime(entry.mtime)}
      </span>
      <span className="truncate px-2 text-left text-xs text-muted-foreground">
        {entryType(entry)}
      </span>
      <span className="truncate px-2 text-left text-xs text-muted-foreground">
        {entry.isDir ? "—" : formatSize(entry.size)}
      </span>
      <div className="flex min-w-0 justify-end px-1">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" title={t`更多`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => onDownload(entry)}>
                <Download /> <Trans>下载</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onInfo(entry)}>
                <Info /> <Trans>简介</Trans>
              </DropdownMenuItem>
              {canExtract ? (
                <DropdownMenuItem onSelect={() => onExtract(entry)}>
                  <FolderOpen /> <Trans>解压</Trans>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => onMove(entry)}>
                <FolderInput /> <Trans>移动</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRename(entry)}>
                <Pencil /> <Trans>重命名</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onDelete(entry)}
              >
                <Trash2 /> <Trans>删除</Trans>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});

export default SftpRow;
