import { Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowUp,
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
}) {
  const { t } = useLingui();
  const actions = (
    <div className="flex items-center gap-2">
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
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs"
          title={cwd ?? undefined}
        >
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
