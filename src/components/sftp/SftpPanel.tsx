import { useCallback, useEffect, useMemo, useState, memo } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Download,
  File as FileIcon,
  FileArchive,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Home,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { Session, SftpEntry } from "~/types";
import * as ipc from "~/lib/ipc";
import { useHostsStore } from "~/store/hosts";
import { useTransfersStore } from "~/store/transfers";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import PromptDialog from "~/components/ui/prompt-dialog";
import ConflictDialog, {
  type ConflictResolution,
} from "~/components/sftp/ConflictDialog";
import { cn } from "~/lib/utils";

interface Props {
  session: Session;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function nextTransferId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function formatMtime(seconds: number): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString();
}

function entryType(entry: SftpEntry): string {
  if (entry.isDir) return "文件夹";
  if (entry.isSymlink) return "链接";
  const dot = entry.name.lastIndexOf(".");
  if (dot <= 0 || dot === entry.name.length - 1) return "文件";
  return entry.name.slice(dot + 1).toLowerCase();
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}
function parentPath(p: string): string {
  if (p === "/" || p === "") return "/";
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}
function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

const ARCHIVE_RE = /\.(zip|tar|tar\.gz|tgz|tar\.bz2|tbz2)$/i;
function isArchive(name: string): boolean {
  return ARCHIVE_RE.test(name);
}
/** The directory name an archive is expected to produce once extracted. */
function archiveStem(name: string): string {
  return name.replace(ARCHIVE_RE, "");
}
function validPlainName(name: string): boolean {
  return name.trim() !== "" && !/[\\/]/.test(name.trim());
}
function joinLocalPath(parent: string, name: string): string {
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return parent.endsWith("/") || parent.endsWith("\\")
    ? `${parent}${name}`
    : `${parent}${separator}${name}`;
}

type PromptState =
  | { kind: "mkdir" }
  | { kind: "rename"; entry: SftpEntry }
  | { kind: "uploadDir"; localDir: string; initialName: string }
  | { kind: "downloadDir"; entry: SftpEntry; initialName: string }
  | null;

/** A pending action blocked on resolving a remote name conflict. */
type ConflictState =
  | {
      name: string; // the conflicting existing name
      incomingLabel: string;
      initialIncomingName?: string;
      initialExistingName?: string;
      run: (resolution: ConflictResolution) => Promise<void>;
    }
  | null;

type LoadingAction = "home" | "parent" | "refresh" | "list" | `enter:${string}`;
type SortKey = "name" | "mtime" | "type" | "size";
type SortDirection = "asc" | "desc";

interface SortState {
  key: SortKey;
  direction: SortDirection;
}

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function loadingLabel(action: LoadingAction | null): string {
  if (!action) return "加载中…";
  if (action === "home") return "正在打开主目录…";
  if (action === "parent") return "正在打开上级目录…";
  if (action === "refresh") return "正在刷新…";
  if (action.startsWith("enter:")) return "正在打开文件夹…";
  return "加载中…";
}

function defaultSortDirection(key: SortKey): SortDirection {
  return key === "mtime" || key === "size" ? "desc" : "asc";
}

function entrySortType(entry: SftpEntry): string {
  if (entry.isDir) return "0:folder";
  if (entry.isSymlink) return "1:symlink";
  const type = entryType(entry);
  return type === "文件" ? "2:file" : `3:${type}`;
}

function compareEntries(a: SftpEntry, b: SftpEntry, sort: SortState): number {
  // Keep directories grouped first for navigation, then sort inside each group.
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;

  let result = 0;
  if (sort.key === "name") {
    result = nameCollator.compare(a.name, b.name);
  } else if (sort.key === "mtime") {
    result = a.mtime - b.mtime;
  } else if (sort.key === "size") {
    result = a.size - b.size;
  } else {
    result = nameCollator.compare(entrySortType(a), entrySortType(b));
  }

  if (result === 0) {
    result = nameCollator.compare(a.name, b.name);
  }

  return sort.direction === "asc" ? result : -result;
}

export default function SftpPanel({ session }: Props) {
  const sessionId = session.id;
  const [cwd, setCwd] = useState<string | null>(null);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<LoadingAction | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });
  const [prompt, setPrompt] = useState<PromptState>(null);
  const [deleteTarget, setDeleteTarget] = useState<SftpEntry | null>(null);
  const [conflict, setConflict] = useState<ConflictState>(null);
  const startTransfer = useTransfersStore((s) => s.start);
  const finishTransfer = useTransfersStore((s) => s.finish);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => compareEntries(a, b, sort)),
    [entries, sort],
  );

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

  const load = useCallback(
    async (path: string, action: LoadingAction = "list") => {
      setLoading(true);
      setLoadingAction(action);
      try {
        const list = await ipc.sftpList(sessionId, path);
        setEntries(list);
        setCwd(path);
      } catch (e) {
        toast.error(String(e));
      } finally {
        setLoading(false);
        setLoadingAction(null);
      }
    },
    [sessionId],
  );

  // On first open, resolve the start directory (host default → home → "/").
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadingAction("list");
      try {
        const host = useHostsStore
          .getState()
          .hosts.find((h) => h.id === session.hostId);
        const start = await ipc.sftpStartDir(sessionId, host?.defaultPath);
        if (!cancelled) await load(start);
      } catch (e) {
        if (!cancelled) {
          toast.error(String(e));
          setLoading(false);
          setLoadingAction(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, session.hostId, load]);

  async function goHome() {
    setLoading(true);
    setLoadingAction("home");
    try {
      const home = await ipc.sftpHome(sessionId);
      await load(home, "home");
    } catch (e) {
      toast.error(String(e));
      setLoading(false);
      setLoadingAction(null);
    }
  }

  // ---- File upload / download ----

  async function onUpload() {
    if (!cwd) return;
    const selected = await openDialog({
      multiple: false,
      directory: false,
      title: "选择上传文件",
    });
    if (typeof selected !== "string") return;
    const name = baseName(selected);
    const transferId = nextTransferId();
    const tid = toast.loading(`上传 ${name}…`);
    startTransfer(transferId, `上传 ${name}`);
    try {
      await ipc.sftpUpload(sessionId, selected, joinPath(cwd, name), transferId);
      finishTransfer(transferId, "success");
      toast.success(`已上传 ${name}`, { id: tid });
      await load(cwd);
    } catch (e) {
      const message = String(e);
      if (message === "传输已取消") {
        finishTransfer(transferId, "cancelled");
        toast.info(`已取消上传 ${name}`, { id: tid });
      } else {
        finishTransfer(transferId, "error", message);
        toast.error(message, { id: tid });
      }
    }
  }

  async function onDownload(entry: SftpEntry) {
    if (entry.isDir) return onDownloadDir(entry);
    const dest = await saveDialog({ defaultPath: entry.name, title: "保存到" });
    if (typeof dest !== "string") return;
    const transferId = nextTransferId();
    const tid = toast.loading(`下载 ${entry.name}…`);
    startTransfer(transferId, `下载 ${entry.name}`);
    try {
      await ipc.sftpDownload(sessionId, entry.path, dest, transferId);
      finishTransfer(transferId, "success");
      toast.success(`已下载 ${entry.name}`, { id: tid });
    } catch (e) {
      const message = String(e);
      if (message === "传输已取消") {
        finishTransfer(transferId, "cancelled");
        toast.info(`已取消下载 ${entry.name}`, { id: tid });
      } else {
        finishTransfer(transferId, "error", message);
        toast.error(message, { id: tid });
      }
    }
  }

  // ---- Folder download ----

  async function onDownloadDir(entry: SftpEntry) {
    setPrompt({
      kind: "downloadDir",
      entry,
      initialName: entry.name,
    });
  }

  async function downloadDirWithName(entry: SftpEntry, folderName: string) {
    const trimmedName = folderName.trim();
    if (!validPlainName(trimmedName)) {
      toast.error("名称不能为空，且不能包含斜杠");
      return;
    }
    setPrompt(null);
    const parent = await openDialog({
      multiple: false,
      directory: true,
      title: "选择保存位置",
    });
    if (typeof parent !== "string") return;
    const dest = joinLocalPath(parent, trimmedName);
    const transferId = nextTransferId();
    const tid = toast.loading(`下载文件夹 ${entry.name}…`);
    startTransfer(transferId, `下载 ${entry.name}`);
    try {
      await ipc.sftpDownloadDir(sessionId, entry.path, dest, transferId);
      finishTransfer(transferId, "success");
      toast.success(`已下载文件夹 ${entry.name}`, { id: tid });
    } catch (e) {
      const message = String(e);
      if (message === "传输已取消") {
        finishTransfer(transferId, "cancelled");
        toast.info(`已取消下载 ${entry.name}`, { id: tid });
      } else {
        finishTransfer(transferId, "error", message);
        toast.error(message, { id: tid });
      }
    }
  }

  // ---- Folder upload ----

  async function onUploadDir() {
    if (!cwd) return;
    const selected = await openDialog({
      multiple: false,
      directory: true,
      title: "选择上传文件夹",
    });
    if (typeof selected !== "string") return;
    const name = baseName(selected);
    await prepareUploadDir(selected, name);
  }

  async function prepareUploadDir(localDir: string, defaultName: string) {
    if (!cwd) return;
    try {
      const exists = await ipc.sftpExists(sessionId, joinPath(cwd, defaultName));
      if (exists) {
        showUploadConflict(localDir, defaultName);
        return;
      }
      setPrompt({
        kind: "uploadDir",
        localDir,
        initialName: defaultName,
      });
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function uploadDirWithPromptName(localDir: string, remoteName: string) {
    if (!validPlainName(remoteName)) {
      toast.error("名称不能为空，且不能包含斜杠");
      return;
    }
    setPrompt(null);
    await uploadDirWithName(localDir, remoteName.trim());
  }

  function showUploadConflict(
    localDir: string,
    remoteName: string,
    initialIncomingName?: string,
    initialExistingName?: string,
  ) {
    setConflict({
      name: remoteName,
      incomingLabel: "上传的文件夹",
      initialIncomingName,
      initialExistingName,
      run: async (resolution) => {
        await resolveUploadConflict(localDir, remoteName, resolution);
      },
    });
  }

  async function resolveUploadConflict(
    localDir: string,
    remoteName: string,
    { incomingName, existingName }: ConflictResolution,
  ) {
    if (!cwd) return;
    if (existingName !== remoteName) {
      const targetExists = await ipc.sftpExists(
        sessionId,
        joinPath(cwd, existingName),
      );
      if (targetExists) {
        toast.error(`远端已存在 “${existingName}”，请重新命名`);
        showUploadConflict(localDir, remoteName, incomingName, existingName);
        return;
      }
      await ipc.sftpRename(
        sessionId,
        joinPath(cwd, remoteName),
        joinPath(cwd, existingName),
      );
    }
    await uploadDirWithName(localDir, incomingName);
  }

  async function uploadDirWithName(localDir: string, remoteName: string) {
    if (!cwd) return;
    // Pre-check remote conflict; if present, ask how to resolve first.
    try {
      const exists = await ipc.sftpExists(sessionId, joinPath(cwd, remoteName));
      if (exists) {
        showUploadConflict(localDir, remoteName);
        return;
      }
    } catch (e) {
      toast.error(String(e));
      return;
    }
    await runUploadDir(localDir, remoteName);
  }

  async function runUploadDir(localDir: string, remoteName: string) {
    if (!cwd) return;
    const transferId = nextTransferId();
    const tid = toast.loading(`正在上传文件夹 ${remoteName}…`);
    startTransfer(transferId, `上传 ${remoteName}`);
    try {
      await ipc.sftpUploadDir(sessionId, localDir, cwd, remoteName, transferId);
      finishTransfer(transferId, "success");
      toast.success(`已上传文件夹 ${remoteName}`, { id: tid });
      await load(cwd);
    } catch (e) {
      const message = String(e);
      if (message === "传输已取消") {
        finishTransfer(transferId, "cancelled");
        toast.info(`已取消上传 ${remoteName}`, { id: tid });
      } else {
        finishTransfer(transferId, "error", message);
        toast.error(message, { id: tid });
      }
    }
  }

  // ---- Remote extract ----

  async function onExtract(entry: SftpEntry) {
    if (!cwd) return;
    await extractWithName(entry, archiveStem(entry.name));
  }

  async function extractWithName(entry: SftpEntry, outName: string) {
    if (!cwd) return;
    try {
      const exists = await ipc.sftpExists(sessionId, joinPath(cwd, outName));
      if (exists) {
        showExtractConflict(entry, outName);
        return;
      }
    } catch (e) {
      toast.error(String(e));
      return;
    }
    await runExtract(entry, outName);
  }

  function showExtractConflict(
    entry: SftpEntry,
    outName: string,
    initialIncomingName?: string,
    initialExistingName?: string,
  ) {
    setConflict({
      name: outName,
      incomingLabel: "解压出的文件夹",
      initialIncomingName,
      initialExistingName,
      run: async (resolution) => {
        await resolveExtractConflict(entry, outName, resolution);
      },
    });
  }

  async function resolveExtractConflict(
    entry: SftpEntry,
    outName: string,
    { incomingName, existingName }: ConflictResolution,
  ) {
    if (!cwd) return;
    if (existingName !== outName) {
      const targetExists = await ipc.sftpExists(
        sessionId,
        joinPath(cwd, existingName),
      );
      if (targetExists) {
        toast.error(`远端已存在 “${existingName}”，请重新命名`);
        showExtractConflict(entry, outName, incomingName, existingName);
        return;
      }
      await ipc.sftpRename(
        sessionId,
        joinPath(cwd, outName),
        joinPath(cwd, existingName),
      );
    }
    await extractWithName(entry, incomingName);
  }

  async function runExtract(entry: SftpEntry, outName: string) {
    if (!cwd) return;
    const tid = toast.loading(`正在解压 ${entry.name}…`);
    setBusy(`解压 ${entry.name}…`);
    try {
      await ipc.sftpExtract(sessionId, entry.path, cwd, outName);
      toast.success(`已解压到 ${outName}`, { id: tid });
      await load(cwd);
    } catch (e) {
      toast.error(String(e), { id: tid });
    } finally {
      setBusy(null);
    }
  }

  // ---- Directory ops ----

  async function doMkdir(name: string) {
    if (!cwd) return;
    setPrompt(null);
    try {
      await ipc.sftpMkdir(sessionId, joinPath(cwd, name));
      await load(cwd);
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function doRename(entry: SftpEntry, name: string) {
    if (!cwd || name === entry.name) {
      setPrompt(null);
      return;
    }
    setPrompt(null);
    try {
      await ipc.sftpRename(sessionId, entry.path, joinPath(cwd, name));
      await load(cwd);
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function confirmDelete() {
    const entry = deleteTarget;
    if (!entry || !cwd) return;
    setDeleteTarget(null);
    const transferId = entry.isDir ? nextTransferId() : undefined;
    const tid = toast.loading(`正在删除 ${entry.name}…`);
    setBusy(`删除 ${entry.name}…`);
    if (transferId) {
      startTransfer(transferId, `删除 ${entry.name}`, { cancellable: false });
    }
    try {
      await ipc.sftpDelete(sessionId, entry.path, entry.isDir, transferId);
      if (transferId) finishTransfer(transferId, "success");
      toast.success(`已删除 ${entry.name}`, { id: tid });
      await load(cwd);
    } catch (e) {
      const message = String(e);
      if (transferId) finishTransfer(transferId, "error", message);
      toast.error(message, { id: tid });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          title="主目录"
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
          title="上级目录"
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
          title="刷新"
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
          <FolderPlus data-icon="inline-start" /> 新建
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={!cwd || !!busy}>
              <Upload data-icon="inline-start" /> 上传
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onUpload}>
              <FileIcon data-icon="inline-start" /> 上传文件
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onUploadDir}>
              <FolderUp data-icon="inline-start" /> 上传文件夹
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {busy ? (
        <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
          <RefreshCw className="size-3 animate-spin" />
          <span className="min-w-0 truncate text-foreground">{busy}</span>
        </div>
      ) : null}

      {/* Listing — a plain div list (not <table>) so content-visibility can
          skip painting off-screen rows, keeping scrolling smooth. */}
      <div className="relative flex-1 overflow-y-auto">
        {loading && entries.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            加载中…
          </div>
        ) : !loading && entries.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpen />
              </EmptyMedia>
              <EmptyTitle>空目录</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div
            key={cwd ?? "sftp-root"}
            className={cn(
              "sftp-list-content transition-opacity duration-150 ease-out",
              loading && !busy && "opacity-60",
            )}
          >
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <SortHeader
                label="名称"
                sortKey="name"
                sort={sort}
                className="flex-1"
                onSort={toggleSort}
              />
              <SortHeader
                label="修改日期"
                sortKey="mtime"
                sort={sort}
                className="w-36"
                onSort={toggleSort}
              />
              <SortHeader
                label="类型"
                sortKey="type"
                sort={sort}
                className="w-16"
                onSort={toggleSort}
              />
              <SortHeader
                label="大小"
                sortKey="size"
                sort={sort}
                className="w-20"
                onSort={toggleSort}
              />
              <span className="w-32 text-right">操作</span>
            </div>
            {sortedEntries.map((entry) => (
              <SftpRow
                key={entry.path}
                entry={entry}
                loading={loadingAction === `enter:${entry.path}`}
                disabled={loading}
                onEnter={(path) => load(path, `enter:${path}`)}
                onDownload={onDownload}
                onExtract={onExtract}
                onRename={(e) => setPrompt({ kind: "rename", entry: e })}
                onDelete={setDeleteTarget}
              />
            ))}
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
        title="新建文件夹"
        placeholder="文件夹名称"
        confirmText="创建"
        onOpenChange={(o) => !o && setPrompt(null)}
        onConfirm={doMkdir}
      />
      <PromptDialog
        open={prompt?.kind === "rename"}
        title="重命名"
        initialValue={prompt?.kind === "rename" ? prompt.entry.name : ""}
        confirmText="重命名"
        onOpenChange={(o) => !o && setPrompt(null)}
        onConfirm={(name) =>
          prompt?.kind === "rename" && doRename(prompt.entry, name)
        }
      />
      <PromptDialog
        open={prompt?.kind === "uploadDir"}
        title="上传文件夹"
        initialValue={prompt?.kind === "uploadDir" ? prompt.initialName : ""}
        placeholder="远端文件夹名称"
        confirmText="继续"
        onOpenChange={(o) => !o && setPrompt(null)}
        onConfirm={(name) =>
          prompt?.kind === "uploadDir" &&
          void uploadDirWithPromptName(prompt.localDir, name)
        }
      />
      <PromptDialog
        open={prompt?.kind === "downloadDir"}
        title="下载文件夹"
        initialValue={prompt?.kind === "downloadDir" ? prompt.initialName : ""}
        placeholder="本地文件夹名称"
        confirmText="继续"
        onOpenChange={(o) => !o && setPrompt(null)}
        onConfirm={(name) =>
          prompt?.kind === "downloadDir" &&
          void downloadDirWithName(prompt.entry, name)
        }
      />

      <ConflictDialog
        open={!!conflict}
        name={conflict?.name ?? ""}
        incomingLabel={conflict?.incomingLabel ?? "文件夹"}
        initialIncomingName={conflict?.initialIncomingName}
        initialExistingName={conflict?.initialExistingName}
        onOpenChange={(o) => !o && setConflict(null)}
        onResolve={(resolution) => {
          const c = conflict;
          setConflict(null);
          if (c) void c.run(resolution).catch((e) => toast.error(String(e)));
        }}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除{deleteTarget?.isDir ? "文件夹" : "文件"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              确定删除 “{deleteTarget?.name}”？
              {deleteTarget?.isDir ? "该文件夹及其全部内容将被永久删除。" : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  className,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  className?: string;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = sort.direction === "asc" ? ChevronUp : ChevronDown;

  return (
    <button
      type="button"
      className={cn(
        "flex min-w-0 items-center gap-1 text-left hover:text-foreground",
        active && "text-foreground",
        className,
      )}
      aria-sort={
        active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
      }
      onClick={() => onSort(sortKey)}
    >
      <span className="truncate">{label}</span>
      {active ? <Icon className="size-3 shrink-0" /> : null}
    </button>
  );
}

interface RowProps {
  entry: SftpEntry;
  loading: boolean;
  disabled: boolean;
  onEnter: (path: string) => void;
  onDownload: (entry: SftpEntry) => void;
  onExtract: (entry: SftpEntry) => void;
  onRename: (entry: SftpEntry) => void;
  onDelete: (entry: SftpEntry) => void;
}

/**
 * A single directory row. Memoized and wrapped with `content-visibility: auto`
 * so the browser skips layout/paint for rows scrolled off-screen — this is
 * what keeps large listings smooth.
 */
const SftpRow = memo(function SftpRow({
  entry,
  loading,
  disabled,
  onEnter,
  onDownload,
  onExtract,
  onRename,
  onDelete,
}: RowProps) {
  const canExtract = !entry.isDir && isArchive(entry.name);
  return (
    <div className="group flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-sm [content-visibility:auto] [contain-intrinsic-size:auto_36px] hover:bg-muted/50">
      <button
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
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
      <span className="w-36 truncate text-left text-xs text-muted-foreground">
        {formatMtime(entry.mtime)}
      </span>
      <span className="w-16 truncate text-left text-xs text-muted-foreground">
        {entryType(entry)}
      </span>
      <span className="w-20 text-left text-xs text-muted-foreground">
        {entry.isDir ? "—" : formatSize(entry.size)}
      </span>
      <div className="flex w-32 justify-end gap-0.5 opacity-0 group-hover:opacity-100">
        {canExtract ? (
          <Button
            variant="ghost"
            size="icon-xs"
            title="解压"
            onClick={() => onExtract(entry)}
          >
            <FolderOpen />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          title="下载"
          onClick={() => onDownload(entry)}
        >
          <Download />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title="重命名"
          onClick={() => onRename(entry)}
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title="删除"
          onClick={() => onDelete(entry)}
        >
          <Trash2 className="text-destructive" />
        </Button>
      </div>
    </div>
  );
});
