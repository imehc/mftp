import { memo, useState } from "react";
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
            <Button variant="ghost" size="icon-xs" title="更多">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => onDownload(entry)}>
                <Download /> 下载
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onInfo(entry)}>
                <Info /> 简介
              </DropdownMenuItem>
              {canExtract ? (
                <DropdownMenuItem onSelect={() => onExtract(entry)}>
                  <FolderOpen /> 解压
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => onMove(entry)}>
                <FolderInput /> 移动
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRename(entry)}>
                <Pencil /> 重命名
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onDelete(entry)}
              >
                <Trash2 /> 删除
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});

export default SftpRow;
