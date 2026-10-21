import { Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowUp,
  ArrowUpDown,
  File,
  FolderPlus,
  FolderUp,
  Home,
  RefreshCw,
  Upload,
} from "lucide-react";
import { createPortal } from "react-dom";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  sftpColumnLabel,
  type SortKey,
  type SortState,
} from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";

export default function SftpToolbar({
  target,
  cwd,
  loading,
  busy,
  onHome,
  onParent,
  onRefresh,
  onCreate,
  onUpload,
  onUploadDir,
  sort,
  onSort,
}: {
  target?: HTMLElement | null;
  cwd: string | null;
  loading: boolean;
  busy: boolean;
  onHome: () => void;
  onParent: () => void;
  onRefresh: () => void;
  onCreate: () => void;
  onUpload: () => void;
  onUploadDir: () => void;
  sort: SortState;
  onSort: (key: SortKey) => void;
}) {
  const { t } = useLingui();
  const sortKeys: SortKey[] = ["name", "mtime", "type", "size"];
  const actions = (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            density="adaptive"
            className="md:hidden"
            aria-label={t`排序`}
          >
            <ArrowUpDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="ui-density-adaptive">
          {sortKeys.map((key) => (
            <DropdownMenuItem key={key} onSelect={() => onSort(key)}>
              <span className="flex-1">{sftpColumnLabel(key)}</span>
              {sort.key === key ? (
                <span className="text-muted-foreground text-xs">
                  {sort.direction === "asc" ? t`升序` : t`降序`}
                </span>
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="outline"
        density="adaptive"
        className="hidden md:inline-flex"
        onClick={onCreate}
        disabled={!cwd || busy}
      >
        <FolderPlus />
        <Trans>新建</Trans>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button density="adaptive" disabled={!cwd || busy}>
            <Upload />
            <Trans>上传</Trans>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="ui-density-adaptive">
          <DropdownMenuItem onSelect={onCreate}>
            <FolderPlus />
            {t`新建`}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onUpload}>
            <File />
            <Trans>上传文件</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onUploadDir}>
            <FolderUp />
            <Trans>上传文件夹</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  return (
    <div className="shrink-0 border-b">
      {/* 操作放入稳定的工作区插槽，移动端与视图切换同行。 */}
      {target ? createPortal(actions, target) : actions}
      <div className="flex min-h-11 min-w-0 items-center gap-1 px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`上级目录`}
          onClick={onParent}
          disabled={loading || !cwd || cwd === "/"}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`主目录`}
          onClick={onHome}
          disabled={loading}
        >
          <Home />
        </Button>
        <span className="min-w-0 flex-1 font-mono text-xs break-all">
          {cwd ?? "…"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`刷新`}
          onClick={onRefresh}
          disabled={loading || !cwd}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
      </div>
    </div>
  );
}
