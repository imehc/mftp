import { Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowUp,
  ChevronDown,
  File,
  FolderPlus,
  FolderUp,
  Home,
  RefreshCw,
  Upload,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  sftpColumnLabel,
  type SortKey,
  type SortState,
} from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";

export default function SftpToolbar({
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
  return (
    <div className="flex min-h-11 min-w-0 shrink-0 items-center gap-1 border-b px-3">
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
        className="hidden md:inline-flex"
        aria-label={t`主目录`}
        onClick={onHome}
        disabled={loading}
      >
        <Home />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t`刷新`}
        onClick={onRefresh}
        disabled={loading || !cwd}
      >
        <RefreshCw className={loading ? "animate-spin" : undefined} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="min-w-16 flex-1 justify-between px-2 md:hidden"
            aria-label={t`目录操作`}
            title={cwd ?? undefined}
          >
            <span className="min-w-0 truncate font-mono text-xs">
              {cwd ?? "…"}
            </span>
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="ui-density-adaptive w-48">
          <DropdownMenuItem onSelect={onHome} disabled={loading}>
            <Home />
            {t`主目录`}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t`排序`}</DropdownMenuLabel>
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
      <span
        className="hidden min-w-0 flex-1 truncate font-mono text-xs md:block"
        title={cwd ?? undefined}
      >
        {cwd ?? "…"}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`新建`}
          onClick={onCreate}
          disabled={!cwd || busy}
        >
          <FolderPlus />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`上传`}
              disabled={!cwd || busy}
            >
              <Upload />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="ui-density-adaptive">
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
    </div>
  );
}
