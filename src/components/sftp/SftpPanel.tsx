import { useCallback, useEffect, useState, memo } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  Download,
  File as FileIcon,
  FileArchive,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Home,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { Session, SftpEntry } from "~/types";
import * as ipc from "~/lib/ipc";
import { useHostsStore } from "~/store/hosts";
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
  type ConflictMode,
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

type PromptState =
  | { kind: "mkdir" }
  | { kind: "rename"; entry: SftpEntry }
  | null;

/** A pending action blocked on resolving a remote name conflict. */
type ConflictState =
  | {
      name: string; // the conflicting existing name
      incomingLabel: string;
      run: (mode: ConflictMode, newName: string) => Promise<void>;
    }
  | null;

export default function SftpPanel({ session }: Props) {
  const sessionId = session.id;
  const [cwd, setCwd] = useState<string | null>(null);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PromptState>(null);
  const [deleteTarget, setDeleteTarget] = useState<SftpEntry | null>(null);
  const [conflict, setConflict] = useState<ConflictState>(null);

  const load = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        const list = await ipc.sftpList(sessionId, path);
        setEntries(list);
        setCwd(path);
      } catch (e) {
        toast.error(String(e));
      } finally {
        setLoading(false);
      }
    },
    [sessionId],
  );

  // On first open, resolve the start directory (host default → home → "/").
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
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
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, session.hostId, load]);

  async function goHome() {
    try {
      const home = await ipc.sftpHome(sessionId);
      await load(home);
    } catch (e) {
      toast.error(String(e));
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
    const tid = toast.loading(`上传 ${name}…`);
    setBusy(`上传 ${name}…`);
    try {
      await ipc.sftpUpload(sessionId, selected, joinPath(cwd, name));
      toast.success(`已上传 ${name}`, { id: tid });
      await load(cwd);
    } catch (e) {
      toast.error(String(e), { id: tid });
    } finally {
      setBusy(null);
    }
  }

  async function onDownload(entry: SftpEntry) {
    if (entry.isDir) return onDownloadDir(entry);
    const dest = await saveDialog({ defaultPath: entry.name, title: "保存到" });
    if (typeof dest !== "string") return;
    const tid = toast.loading(`下载 ${entry.name}…`);
    setBusy(`下载 ${entry.name}…`);
    try {
      await ipc.sftpDownload(sessionId, entry.path, dest);
      toast.success(`已下载 ${entry.name}`, { id: tid });
    } catch (e) {
      toast.error(String(e), { id: tid });
    } finally {
      setBusy(null);
    }
  }

  // ---- Folder download (packed as .tar.gz for transfer) ----

  async function onDownloadDir(entry: SftpEntry) {
    const dest = await saveDialog({
      defaultPath: `${entry.name}.tar.gz`,
      title: "下载文件夹",
    });
    if (typeof dest !== "string") return;
    const tid = toast.loading(`正在下载 ${entry.name}…`);
    setBusy(`下载 ${entry.name}…`);
    try {
      await ipc.sftpDownloadDir(sessionId, entry.path, dest);
      toast.success(`已下载 ${baseName(dest)}`, { id: tid });
    } catch (e) {
      toast.error(String(e), { id: tid });
    } finally {
      setBusy(null);
    }
  }

  // ---- Folder upload (local pack → upload → remote extract) ----

  async function onUploadDir() {
    if (!cwd) return;
    const selected = await openDialog({
      multiple: false,
      directory: true,
      title: "选择上传文件夹",
    });
    if (typeof selected !== "string") return;
    const name = baseName(selected);
    await uploadDirWithName(selected, name);
  }

  async function uploadDirWithName(localDir: string, remoteName: string) {
    if (!cwd) return;
    // Pre-check remote conflict; if present, ask how to resolve first.
    try {
      const exists = await ipc.sftpExists(sessionId, joinPath(cwd, remoteName));
      if (exists) {
        setConflict({
          name: remoteName,
          incomingLabel: "上传的文件夹",
          run: async (mode, newName) => {
            if (mode === "incoming") {
              await uploadDirWithName(localDir, newName);
            } else {
              // Rename the existing remote folder out of the way, then upload.
              await ipc.sftpRename(
                sessionId,
                joinPath(cwd, remoteName),
                joinPath(cwd, newName),
              );
              await runUploadDir(localDir, remoteName);
            }
          },
        });
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
    const tid = toast.loading(`正在压缩并上传 ${remoteName}…`);
    setBusy(`压缩上传 ${remoteName}…`);
    try {
      await ipc.sftpUploadDir(sessionId, localDir, cwd, remoteName);
      toast.success(`已上传文件夹 ${remoteName}`, { id: tid });
      await load(cwd);
    } catch (e) {
      toast.error(String(e), { id: tid });
    } finally {
      setBusy(null);
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
        setConflict({
          name: outName,
          incomingLabel: "解压出的文件夹",
          run: async (mode, newName) => {
            if (mode === "incoming") {
              await extractWithName(entry, newName);
            } else {
              await ipc.sftpRename(
                sessionId,
                joinPath(cwd, outName),
                joinPath(cwd, newName),
              );
              await runExtract(entry, outName);
            }
          },
        });
        return;
      }
    } catch (e) {
      toast.error(String(e));
      return;
    }
    await runExtract(entry, outName);
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
    try {
      await ipc.sftpDelete(sessionId, entry.path, entry.isDir);
      toast.success(`已删除 ${entry.name}`);
      await load(cwd);
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" title="主目录" onClick={goHome}>
          <Home />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="上级目录"
          onClick={() => cwd && load(parentPath(cwd))}
          disabled={!cwd || cwd === "/"}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="刷新"
          onClick={() => cwd && load(cwd)}
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
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
        <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
          <RefreshCw className="size-3 animate-spin" />
          {busy}
        </div>
      ) : null}

      {/* Listing — a plain div list (not <table>) so content-visibility can
          skip painting off-screen rows, keeping scrolling smooth. */}
      <div className="flex-1 overflow-y-auto">
        {!loading && entries.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpen />
              </EmptyMedia>
              <EmptyTitle>空目录</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div>
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <span className="flex-1">名称</span>
              <span className="w-20 text-right">大小</span>
              <span className="w-32 text-right">操作</span>
            </div>
            {entries.map((entry) => (
              <SftpRow
                key={entry.path}
                entry={entry}
                onEnter={load}
                onDownload={onDownload}
                onExtract={onExtract}
                onRename={(e) => setPrompt({ kind: "rename", entry: e })}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        )}
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

      <ConflictDialog
        open={!!conflict}
        name={conflict?.name ?? ""}
        incomingLabel={conflict?.incomingLabel ?? "文件夹"}
        onOpenChange={(o) => !o && setConflict(null)}
        onResolve={(mode, newName) => {
          const c = conflict;
          setConflict(null);
          if (c) void c.run(mode, newName).catch((e) => toast.error(String(e)));
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

interface RowProps {
  entry: SftpEntry;
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
        disabled={!entry.isDir}
      >
        {entry.isDir ? (
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
      <span className="w-20 text-right text-xs text-muted-foreground">
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
