import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type TouchEventHandler,
} from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnSizingState,
} from "@tanstack/react-table";
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
  sftpHeaderHeight,
  type ConflictState,
  type DirectoryPickerState,
  type InfoState,
  type PromptState,
  type SortKey,
  type SortState,
} from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";
import { cn } from "~/lib/utils";

interface Props {
  session: Session;
}


export default function SftpPanel({ session }: Props) {
  const { t } = useLingui();
  const sessionId = session.id;
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const userResizedColumnsRef = useRef(false);
  const { cwd, entries, loading, loadingAction, load, goHome } =
    useSftpNavigation(session);
  const [busy, setBusy] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });
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

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => compareEntries(a, b, sort)),
    [entries, sort],
  );

  const table = useReactTable({
    data: sortedEntries,
    columns: sftpColumns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: "onChange",
    state: { columnSizing },
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
      .map((header) => `${header.getSize()}px`)
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

  const toggleSort = useCallback((key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? {
            key,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : { key, direction: defaultSortDirection(key) },
    );
  }, []);

  async function showInfo(entry: SftpEntry) {
    setInfo({ entry, details: null, loading: true });
    try {
      const details = await ipc.sftpInfo(sessionId, entry.path);
      setInfo((current) => {
        if (!current || current.entry.path !== entry.path) return current;
        return { entry, details, loading: false };
      });
    } catch (e) {
      toast.error(String(e));
      setInfo((current) => {
        if (!current || current.entry.path !== entry.path) return current;
        return { ...current, loading: false };
      });
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          title={t`主目录`}
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
          onClick={() => cwd && load(cwd, "refresh")}
          disabled={loading || !cwd}
        >
          {loadingAction === "refresh" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <RefreshCw />
          )}
        </Button>
        <div className="mx-1 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
          {cwd ?? "…"}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPrompt({ kind: "mkdir" })}
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
        <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
          <RefreshCw className="size-3 animate-spin" />
          <span className="min-w-0 truncate text-foreground">{busy}</span>
        </div>
      ) : null}

      {/* Listing */}
      <div ref={listScrollRef} className="relative flex-1 overflow-y-auto">
        {loading && entries.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
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
            <div className="sticky top-0 z-10 grid grid-cols-[var(--sftp-list-columns)] border-b border-border bg-background px-3 text-xs font-medium text-muted-foreground">
              {headerGroup.headers.map((header) => {
                const id = header.column.id;
                const sortable = id !== "actions";
                return (
                  <ResizableHeader
                    key={header.id}
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
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                const entry = row.original;
                return (
                  <div
                    key={row.id}
                    className="absolute left-0 top-0 w-full"
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
                      onRename={(e) => setPrompt({ kind: "rename", entry: e })}
                      onDelete={setDeleteTarget}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {loading && entries.length > 0 && !busy ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 backdrop-blur-[1px] duration-150 animate-in fade-in-0">
            <div className="flex items-center gap-2 rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm duration-150 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1">
              <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
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

      <FileInfoDialog
        info={info}
        onOpenChange={(o) => !o && setInfo(null)}
      />

      <DeleteConfirmDialog
        target={deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function ResizableHeader({
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
  const active = sortKey != null && sort.key === sortKey;
  const Icon = sort.direction === "asc" ? ChevronUp : ChevronDown;

  return (
    <div className="relative min-w-0 border-r border-border/70 last:border-r-0">
      <button
        type="button"
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-1 px-2 text-left hover:text-foreground disabled:pointer-events-none",
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
            "after:absolute after:top-1 after:right-0 after:h-6 after:w-px after:bg-border",
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
