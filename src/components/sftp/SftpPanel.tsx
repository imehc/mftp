import { useCallback, useEffect, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  Download,
  File as FileIcon,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { Session, SftpEntry } from "~/types";
import * as ipc from "~/lib/ipc";
import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
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

type PromptState =
  | { kind: "mkdir" }
  | { kind: "rename"; entry: SftpEntry }
  | null;

export default function SftpPanel({ session }: Props) {
  const sessionId = session.id;
  const [cwd, setCwd] = useState<string | null>(null);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PromptState>(null);
  const [deleteTarget, setDeleteTarget] = useState<SftpEntry | null>(null);

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

  // On first open, resolve the home directory and list it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const home = await ipc.sftpHome(sessionId);
        if (!cancelled) await load(home);
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
  }, [sessionId, load]);

  async function goHome() {
    try {
      const home = await ipc.sftpHome(sessionId);
      await load(home);
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function onUpload() {
    if (!cwd) return;
    const selected = await openDialog({
      multiple: false,
      directory: false,
      title: "选择上传文件",
    });
    if (typeof selected !== "string") return;
    const name = selected.split(/[\\/]/).pop() ?? "upload";
    setBusy(`上传 ${name}…`);
    try {
      await ipc.sftpUpload(sessionId, selected, joinPath(cwd, name));
      toast.success(`已上传 ${name}`);
      await load(cwd);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onDownload(entry: SftpEntry) {
    const dest = await saveDialog({ defaultPath: entry.name, title: "保存到" });
    if (typeof dest !== "string") return;
    setBusy(`下载 ${entry.name}…`);
    try {
      await ipc.sftpDownload(sessionId, entry.path, dest);
      toast.success(`已下载 ${entry.name}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  }

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
          disabled={!cwd}
        >
          <FolderPlus data-icon="inline-start" /> 新建
        </Button>
        <Button variant="outline" size="sm" onClick={onUpload} disabled={!cwd}>
          <Upload data-icon="inline-start" /> 上传
        </Button>
      </div>

      {busy ? (
        <div className="border-b border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
          {busy}
        </div>
      ) : null}

      {/* Listing */}
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
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead className="w-24 text-right">大小</TableHead>
                <TableHead className="w-32 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.path} className="group">
                  <TableCell>
                    <button
                      className="flex items-center gap-2 text-left"
                      onDoubleClick={() => entry.isDir && load(entry.path)}
                      disabled={!entry.isDir}
                    >
                      {entry.isDir ? (
                        <Folder className="size-4 shrink-0 text-primary" />
                      ) : (
                        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className={cn(entry.isDir && "cursor-pointer")}>
                        {entry.name}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {entry.isDir ? "—" : formatSize(entry.size)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {!entry.isDir ? (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="下载"
                          onClick={() => onDownload(entry)}
                        >
                          <Download />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="重命名"
                        onClick={() => setPrompt({ kind: "rename", entry })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="删除"
                        onClick={() => setDeleteTarget(entry)}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
              {deleteTarget?.isDir ? "文件夹须为空。" : ""}
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
