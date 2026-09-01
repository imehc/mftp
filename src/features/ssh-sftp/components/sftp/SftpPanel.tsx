import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type TouchEventHandler,
} from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useTable, type ColumnSizingState } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  File as FileIcon,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Home,
  LoaderCircle,
  RefreshCw,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { Session, SftpEntry } from "~/types";
import * as ipc from "~/lib/ipc";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import PromptDialog from "~/components/ui/prompt-dialog";
import ConflictDialog from "~/features/ssh-sftp/components/sftp/ConflictDialog";
import DeleteConfirmDialog from "~/features/ssh-sftp/components/sftp/DeleteConfirmDialog";
import ExtractDialog from "~/features/ssh-sftp/components/sftp/ExtractDialog";
import FileInfoDialog from "~/features/ssh-sftp/components/sftp/FileInfoDialog";
import RemoteDirectoryPicker from "~/features/ssh-sftp/components/sftp/RemoteDirectoryPicker";
import SftpRow from "~/features/ssh-sftp/components/sftp/SftpRow";
import { useSftpNavigation } from "~/features/ssh-sftp/components/sftp/useSftpNavigation";
import { useSftpRemoteActions } from "~/features/ssh-sftp/components/sftp/useSftpRemoteActions";
import { useSftpTransferActions } from "~/features/ssh-sftp/components/sftp/useSftpTransferActions";
import {
  compareEntries,
  computeInitialSftpColumnSizing,
  defaultSortDirection,
  loadingLabel,
  parentPath,
  sameColumnSizing,
  sftpColumnLabel,
  sftpColumns,
  sftpFeatures,
  sftpHeaderHeight,
  type ConflictState,
  type DirectoryPickerState,
  type InfoState,
  type PromptState,
  type SortKey,
  type SortState,
} from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";
import { cn } from "~/lib/utils";
import { useMediaQuery } from "~/lib/use-media-query";
interface Props {
  session: Session;
}
export default function SftpPanel({ session }: Props) {
  const { t } = useLingui();
  const sessionId = session.id;
  const compact = useMediaQuery("(max-width: 640px)");
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const userResizedColumnsRef = useRef(false);
  const { cwd, entries, loading, loadingAction, load, goHome } =
    useSftpNavigation(session);
  const [busy, setBusy] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({
    key: "name",
    direction: "asc",
  });
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [prompt, setPrompt] = useState<PromptState>(null);
  const [info, setInfo] = useState<InfoState>(null);
  const [directoryPicker, setDirectoryPicker] =
    useState<DirectoryPickerState>(null);
  const [conflict, setConflict] = useState<ConflictState>(null);
  const {
    onUpload,
    onDownload,
    onUploadDir,
    downloadDirWithName,
    uploadDirWithPromptName,
  } = useSftpTransferActions({
    sessionId,
    cwd,
    load,
    setPrompt,
    setConflict,
  });
  const {
    extractTarget,
    setExtractTarget,
    deleteTarget,
    setDeleteTarget,
    onExtract,
    chooseExtractParent,
    confirmExtract,
    onMove,
    doMkdir,
    doRename,
    confirmDelete,
  } = useSftpRemoteActions({
    sessionId,
    cwd,
    load,
    setBusy,
    setPrompt,
    setConflict,
    setDirectoryPicker,
  });
  const sortedEntries = [...entries].sort((a, b) => compareEntries(a, b, sort));
  const table = useTable({
    data: sortedEntries,
    columns: sftpColumns,
    features: sftpFeatures,
    columnResizeMode: "onChange",
    state: {
      columnSizing,
    },
    onColumnSizingChange: setColumnSizing,
    enableColumnResizing: true,
  });
  const rows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 36,
    overscan: 12,
    scrollMargin: sftpHeaderHeight,
  });
  const headerGroup = table.getHeaderGroups()[0];
  const listColumnStyle = {
    "--sftp-list-columns": headerGroup.headers
      .map((header) => {
        if (!compact) return `${header.getSize()}px`;
        if (header.column.id === "name") return "minmax(0, 1fr)";
        if (header.column.id === "size") return "5rem";
        if (header.column.id === "actions") return "3.5rem";
        return "0px";
      })
      .join(" "),
  } as CSSProperties;
  useEffect(() => {
    const element = listScrollRef.current;
    if (!element) return;
    userResizedColumnsRef.current = false;
    const fitColumns = (width: number) => {
      if (userResizedColumnsRef.current) return;
      const next = computeInitialSftpColumnSizing(width);
      setColumnSizing((current) =>
        sameColumnSizing(current, next) ? current : next,
      );
    };
    fitColumns(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? element.clientWidth;
      fitColumns(width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [sessionId]);
  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? {
            key,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : {
            key,
            direction: defaultSortDirection(key),
          },
    );
  };
  async function showInfo(entry: SftpEntry) {
    setInfo({
      entry,
      details: null,
      loading: true,
    });
    try {
      const details = await ipc.sftpInfo(sessionId, entry.path);
      setInfo((current) => {
        if (!current || current.entry.path !== entry.path) return current;
        return {
          entry,
          details,
          loading: false,
        };
      });
    } catch (e) {
      toast.error(String(e));
      setInfo((current) => {
        if (!current || current.entry.path !== entry.path) return current;
        return {
          ...current,
          loading: false,
        };
      });
    }
  }
  return (
    <div className="bg-background flex h-full flex-col">
      {/* 工具栏 */}
      <div className="border-border flex items-center gap-1 border-b px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          title={t`主目录`}
          aria-label={t`主目录`}
          className="max-sm:min-h-11 max-sm:min-w-11"
          onClick={goHome}
          disabled={loading}
        >
          {loadingAction === "home" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Home />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t`上级目录`}
          aria-label={t`上级目录`}
          className="max-sm:min-h-11 max-sm:min-w-11"
          onClick={() => cwd && load(parentPath(cwd), "parent")}
          disabled={loading || !cwd || cwd === "/"}
        >
          {loadingAction === "parent" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <ArrowUp />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t`刷新`}
          aria-label={t`刷新`}
          className="max-sm:min-h-11 max-sm:min-w-11"
          onClick={() => cwd && load(cwd, "refresh")}
          disabled={loading || !cwd}
        >
          {loadingAction === "refresh" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <RefreshCw />
          )}
        </Button>
        <div className="bg-muted mx-1 flex-1 truncate rounded-md px-2 py-1 font-mono text-xs">
          {cwd ?? "…"}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setPrompt({
              kind: "mkdir",
            })
          }
          disabled={!cwd || !!busy}
        >
          <FolderPlus data-icon="inline-start" /> <Trans>新建</Trans>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={!cwd || !!busy}>
              <Upload data-icon="inline-start" /> <Trans>上传</Trans>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onUpload}>
                <FileIcon /> <Trans>上传文件</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onUploadDir}>
                <FolderUp /> <Trans>上传文件夹</Trans>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {busy ? (
        <div className="border-border bg-muted/50 text-muted-foreground flex items-center gap-2 border-b px-3 py-1.5 text-xs">
          <RefreshCw className="size-3 animate-spin" />
          <span className="text-foreground min-w-0 truncate">{busy}</span>
        </div>
      ) : null}

      {/* 文件列表 */}
      <div ref={listScrollRef} className="relative flex-1 overflow-y-auto">
        {loading && entries.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin" />
            <Trans>加载中…</Trans>
          </div>
        ) : !loading && entries.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpen />
              </EmptyMedia>
              <EmptyTitle>
                <Trans>空目录</Trans>
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div
            key={cwd ?? "sftp-root"}
            className={cn(
              "sftp-list-content transition-opacity duration-150 ease-out",
              loading && !busy && "opacity-60",
            )}
            style={listColumnStyle}
          >
            <div className="border-border bg-background text-muted-foreground sticky top-0 z-10 grid grid-cols-[var(--sftp-list-columns)] border-b px-3 text-xs font-medium">
              {headerGroup.headers.map((header) => {
                const id = header.column.id;
                const sortable = id !== "actions";
                return (
                  <ResizableHeader
                    key={header.id}
                    hidden={compact && (id === "mtime" || id === "type")}
                    label={sftpColumnLabel(id)}
                    sortKey={sortable ? (id as SortKey) : undefined}
                    sort={sort}
                    alignEnd={id === "actions"}
                    canResize={header.column.getCanResize()}
                    isResizing={header.column.getIsResizing()}
                    onResizeStart={() => {
                      userResizedColumnsRef.current = true;
                    }}
                    onResizeMouseDown={header.getResizeHandler()}
                    onResizeTouchStart={header.getResizeHandler()}
                    onSort={toggleSort}
                  />
                );
              })}
            </div>
            <div
              className="relative"
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                const entry = row.original;
                return (
                  <div
                    key={row.id}
                    className="absolute top-0 left-0 w-full"
                    style={{
                      transform: `translateY(${virtualRow.start - sftpHeaderHeight}px)`,
                    }}
                  >
                    <SftpRow
                      entry={entry}
                      loading={loadingAction === `enter:${entry.path}`}
                      disabled={loading}
                      onEnter={(path) => load(path, `enter:${path}`)}
                      onInfo={showInfo}
                      onDownload={onDownload}
                      onExtract={onExtract}
                      onMove={onMove}
                      onRename={(e) =>
                        setPrompt({
                          kind: "rename",
                          entry: e,
                        })
                      }
                      onDelete={setDeleteTarget}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {loading && entries.length > 0 && !busy ? (
          <div className="bg-background/70 animate-in fade-in-0 absolute inset-0 z-20 flex items-center justify-center backdrop-blur-[1px] duration-150">
            <div className="border-border bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 flex items-center gap-2 rounded-md border px-3 py-2 text-sm shadow-sm duration-150">
              <LoaderCircle className="text-muted-foreground size-4 animate-spin" />
              {loadingLabel(loadingAction)}
            </div>
          </div>
        ) : null}
      </div>

      <PromptDialog
        open={prompt?.kind === "mkdir"}
        title={t`新建文件夹`}
        placeholder={t`文件夹名称`}
        confirmText={t`创建`}
        onOpenChange={(o) => !o && setPrompt(null)}
        onConfirm={doMkdir}
      />
      <PromptDialog
        open={prompt?.kind === "rename"}
        title={t`重命名`}
        initialValue={prompt?.kind === "rename" ? prompt.entry.name : ""}
        confirmText={t`重命名`}
        onOpenChange={(o) => !o && setPrompt(null)}
        onConfirm={(name) =>
          prompt?.kind === "rename" && doRename(prompt.entry, name)
        }
      />
      <PromptDialog
        open={prompt?.kind === "uploadDir"}
        title={t`上传文件夹`}
        initialValue={prompt?.kind === "uploadDir" ? prompt.initialName : ""}
        placeholder={t`远端文件夹名称`}
        confirmText={t`继续`}
        onOpenChange={(o) => !o && setPrompt(null)}
        onConfirm={(name) =>
          prompt?.kind === "uploadDir" &&
          void uploadDirWithPromptName(prompt.localDir, name)
        }
      />
      <PromptDialog
        open={prompt?.kind === "downloadDir"}
        title={t`下载文件夹`}
        initialValue={prompt?.kind === "downloadDir" ? prompt.initialName : ""}
        placeholder={t`本地文件夹名称`}
        confirmText={t`继续`}
        onOpenChange={(o) => !o && setPrompt(null)}
        onConfirm={(name) =>
          prompt?.kind === "downloadDir" &&
          void downloadDirWithName(prompt.entry, name)
        }
      />

      <ExtractDialog
        extractTarget={extractTarget}
        directoryPickerOpen={!!directoryPicker}
        setExtractTarget={setExtractTarget}
        chooseExtractParent={chooseExtractParent}
        confirmExtract={confirmExtract}
      />

      <RemoteDirectoryPicker
        open={!!directoryPicker}
        title={directoryPicker?.title ?? ""}
        sessionId={sessionId}
        initialPath={directoryPicker?.initialPath ?? cwd ?? "/"}
        disabledPath={directoryPicker?.disabledPath}
        onOpenChange={(o) => !o && setDirectoryPicker(null)}
        onSelect={(path) => directoryPicker?.onSelect(path)}
      />

      <ConflictDialog
        open={!!conflict}
        name={conflict?.name ?? ""}
        incomingLabel={conflict?.incomingLabel ?? t`文件夹`}
        initialIncomingName={conflict?.initialIncomingName}
        initialExistingName={conflict?.initialExistingName}
        onOpenChange={(o) => !o && setConflict(null)}
        onResolve={(resolution) => {
          const c = conflict;
          setConflict(null);
          if (c) void c.run(resolution).catch((e) => toast.error(String(e)));
        }}
      />

      <FileInfoDialog info={info} onOpenChange={(o) => !o && setInfo(null)} />

      <DeleteConfirmDialog
        target={deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
function ResizableHeader({
  hidden,
  label,
  sortKey,
  sort,
  alignEnd = false,
  canResize,
  isResizing,
  onResizeStart,
  onResizeMouseDown,
  onResizeTouchStart,
  onSort,
}: {
  hidden?: boolean;
  label: string;
  sortKey?: SortKey;
  sort: SortState;
  alignEnd?: boolean;
  canResize: boolean;
  isResizing: boolean;
  onResizeStart: () => void;
  onResizeMouseDown: MouseEventHandler<HTMLDivElement>;
  onResizeTouchStart: TouchEventHandler<HTMLDivElement>;
  onSort: (key: SortKey) => void;
}) {
  if (hidden) return <span aria-hidden />;
  const active = sortKey != null && sort.key === sortKey;
  const Icon = sort.direction === "asc" ? ChevronUp : ChevronDown;
  return (
    <div className="border-border/70 relative min-w-0 border-r last:border-r-0">
      <button
        type="button"
        className={cn(
          "hover:text-foreground flex h-8 w-full min-w-0 items-center gap-1 px-2 text-left disabled:pointer-events-none",
          alignEnd && "justify-end text-right",
          active && "text-foreground",
        )}
        aria-sort={
          active
            ? sort.direction === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
        disabled={!sortKey}
        onClick={() => sortKey && onSort(sortKey)}
      >
        <span className="truncate">{label}</span>
        {active ? <Icon className="size-3 shrink-0" /> : null}
      </button>
      {canResize ? (
        <div
          role="separator"
          aria-orientation="vertical"
          className={cn(
            "absolute top-0 right-0 h-full w-2 cursor-col-resize touch-none select-none",
            "after:bg-border after:absolute after:top-1 after:right-0 after:h-6 after:w-px",
            "hover:after:bg-foreground/50",
            isResizing && "after:bg-primary",
          )}
          onMouseDown={(event) => {
            onResizeStart();
            onResizeMouseDown(event);
          }}
          onTouchStart={(event) => {
            onResizeStart();
            onResizeTouchStart(event);
          }}
        />
      ) : null}
    </div>
  );
}
