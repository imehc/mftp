import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { Magnet, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import * as ipc from "~/lib/ipc";
import { translate } from "~/i18n/translate";
import type { BtFileMeta, BtProbeResult, BtTaskInfo } from "~/types";
import { useTransfersStore } from "~/store/transfers";
import TransferPanel from "~/features/transfers/TransferPanel";
import { formatBytes } from "~/lib/format";
import { BT_TASK_EVENT } from "~/lib/events";
import { previewKind } from "~/lib/preview-kind";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import AddTorrentDialog from "./components/AddTorrentDialog";
import CacheManager from "./components/CacheManager";
import PeersDialog from "./components/PeersDialog";
import {
  clearPreviewLaunch,
  markPreviewLaunch,
  takePreviewLaunch,
} from "./probe-cache";

/** Rebuild a shareable magnet from the infohash; the original link is not
 *  stored (the engine keeps the torrent, not the URL it came from). */
function magnetOf(task: BtTaskInfo) {
  return `magnet:?xt=urn:btih:${task.infoHash}&dn=${encodeURIComponent(task.label)}`;
}

/**
 * BT downloads page (desktop). Doubles as the history list: unfinished tasks
 * show live progress and peers, finished ones stay as records that can be
 * copied as a magnet or deleted. Online preview opens the shared preview page.
 */
export default function BtTool() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tasks, setTasks] = useState<BtTaskInfo[]>([]);
  const [peersTask, setPeersTask] = useState<BtTaskInfo | null>(null);
  // Magnet prefilled into the add dialog when it is opened from a task row;
  // empty means a blank add flow.
  const [prefill, setPrefill] = useState<string | null>(null);
  const [prefillProbe, setPrefillProbe] = useState<BtProbeResult | null>(null);
  const [magnetTask, setMagnetTask] = useState<BtTaskInfo | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BtTaskInfo | null>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const startTransfer = useTransfersStore((s) => s.start);
  const restoreTransfer = useTransfersStore((s) => s.restore);
  const finishTransfer = useTransfersStore((s) => s.finish);
  const updateProgressBatch = useTransfersStore((s) => s.updateProgressBatch);
  const returnedPreview = useRef<{
    infoHash: string;
    cleanupCache: boolean;
    preparation?: Promise<unknown>;
  } | null>(null);
  // Tasks already registered into the panel, mapped to the shape they were
  // registered with; guards duplicate registration from polling while still
  // noticing a task that changed underneath (see registerTask).
  const registered = useRef(new Map<string, string>());

  const registerTask = useCallback(
    (task: BtTaskInfo, explicit = false) => {
      // A preview cache can turn into a download, and a download can be
      // re-added with more files selected. Both change this signature, and
      // the panel row is keyed by id, so start() replaces the stale row
      // instead of leaving a finished one behind.
      const id = `bt:${task.infoHash}`;
      const signature = `${task.mode}:${task.packageMode}:${task.total ?? "unknown"}`;
      const current = useTransfersStore
        .getState()
        .transfers.find((item) => item.id === id);
      const shouldStart =
        registered.current.get(task.infoHash) !== signature ||
        !current ||
        (task.status !== "Error" && current.status !== "running");
      if (shouldStart) {
        registered.current.set(task.infoHash, signature);
        const register = explicit ? startTransfer : restoreTransfer;
        register(id, task.label, {
          cancellable: true,
          source: "bt",
          mode: task.mode === "preview" ? "preview" : "download",
        });
      }
      if (task.status === "Packaging") {
        updateProgressBatch([
          {
            id,
            phase: "bt:packaging",
            transferred: task.progress ?? task.total ?? 0,
            total: task.total ?? null,
            finished: false,
          },
        ]);
      } else if (task.status === "Error") {
        finishTransfer(id, "error", task.error ?? undefined);
      }
    },
    [finishTransfer, restoreTransfer, startTransfer, updateProgressBatch],
  );

  const refresh = useCallback(async () => {
    try {
      setTasks(await ipc.btList());
    } catch {
      // Lazy engine start may fail; keep the empty state instead of crashing.
      setTasks([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Back from the preview page: consume the one-time source/probe handoff so
  // the same dialog can resume without making this cache reusable elsewhere.
  useEffect(() => {
    const handoff = takePreviewLaunch();
    if (handoff) {
      returnedPreview.current = {
        infoHash: handoff.probe.infoHash,
        cleanupCache: !handoff.transferWasVisible,
        preparation: handoff.preparation,
      };
      setPrefill(handoff.source);
      setPrefillProbe(handoff.probe);
      setDialogOpen(true);
    }
  }, []);

  useEffect(() => {
    for (const task of tasks) {
      if (task.status === "Completed" || task.status === "Cancelled") {
        const id = `bt:${task.infoHash}`;
        const transfer = useTransfersStore
          .getState()
          .transfers.find((item) => item.id === id);
        if (transfer?.status === "running") {
          finishTransfer(id, task.status === "Completed" ? "success" : "cancelled");
        }
        // Drop the memo so a task that starts again (re-added to another
        // folder with the same files) gets a fresh panel row.
        registered.current.delete(task.infoHash);
      } else {
        registerTask(task);
      }
    }
  }, [finishTransfer, registerTask, tasks]);

  // Save-to-local results arrive via events from the background watcher
  // (unfinished tasks notify only after download completes). The unlisten
  // handle arrives asynchronously, so a cleanup running before it resolves
  // must remember to drop it — otherwise the subscription leaks and one save
  // toasts once per leak.
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | null = null;
    void listen<{ infoHash: string; kind: string }>(BT_TASK_EVENT, (event) => {
      if (event.payload.kind === "saved") {
        toast.success(translate(msg`已转存到本地`));
        registered.current.delete(event.payload.infoHash);
        void refresh();
      } else if (event.payload.kind.startsWith("save-failed")) {
        toast.error(translate(msg`转存失败`), {
          description: event.payload.kind.slice("save-failed:".length),
        });
        void refresh();
      } else if (event.payload.kind === "package-completed") {
        finishTransfer(`bt:${event.payload.infoHash}`, "success");
        registered.current.delete(event.payload.infoHash);
        void refresh();
      } else if (event.payload.kind.startsWith("package-failed:")) {
        finishTransfer(
          `bt:${event.payload.infoHash}`,
          "error",
          event.payload.kind.slice("package-failed:".length),
        );
        void refresh();
      } else if (event.payload.kind === "removed") {
        registered.current.delete(event.payload.infoHash);
        void refresh();
      } else if (event.payload.kind === "cancelled") {
        finishTransfer(`bt:${event.payload.infoHash}`, "cancelled");
        registered.current.delete(event.payload.infoHash);
        void refresh();
      }
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else dispose = unlisten;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [finishTransfer, refresh]);

  /** Online preview: enter the route first; it prepares the cache task. */
  const handlePreview = useCallback(
    async (source: string, file: BtFileMeta, probe: BtProbeResult) => {
      if (!source) return;
      const transferWasVisible = useTransfersStore
        .getState()
        .transfers.some((item) => item.id === `bt:${probe.infoHash}`);
      markPreviewLaunch(source, probe, transferWasVisible);
      setDialogOpen(false);
      try {
        await navigate({
          to: "/preview",
          search: {
            name: file.path.split("/").pop() ?? file.path,
            kind: previewKind(file.path),
            hash: probe.infoHash,
            index: file.index,
          },
        });
      } catch (error) {
        clearPreviewLaunch();
        toast.error(t`在线预览失败`, { description: String(error) });
        setDialogOpen(true);
      }
    },
    [navigate, t],
  );

  const openAdd = useCallback(() => {
    returnedPreview.current = null;
    setPrefill(null);
    setPrefillProbe(null);
    setDialogOpen(true);
  }, []);

  const cleanupReturnedPreview = useCallback(async () => {
    const context = returnedPreview.current;
    returnedPreview.current = null;
    if (!context?.cleanupCache) return;
    try {
      await context.preparation?.catch(() => undefined);
      const task = (await ipc.btList()).find(
        (item) => item.infoHash === context.infoHash,
      );
      const isTemporaryPreview =
        task?.mode === "preview" ||
        (task?.status === "Completed" && task.packageMode === "Archive");
      if (isTemporaryPreview) {
        await ipc.btRemoveCache(context.infoHash);
        useTransfersStore.getState().dismiss(`bt:${context.infoHash}`);
        await refresh();
      }
    } catch (error) {
      toast.error(t`清理预览缓存失败`, { description: String(error) });
    }
  }, [refresh, t]);

  const handleAdded = useCallback(
    (task: BtTaskInfo) => {
      setTasks((current) => [
        task,
        ...current.filter((item) => item.infoHash !== task.infoHash),
      ]);
      registerTask(task, true);
    },
    [registerTask],
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await ipc.btControl(
        target.infoHash,
        "Remove",
        target.mode === "preview" || deleteFiles,
      );
      registered.current.delete(target.infoHash);
      const transfer = useTransfersStore
        .getState()
        .transfers.find((item) => item.id === `bt:${target.infoHash}`);
      if (transfer?.status === "running") {
        finishTransfer(transfer.id, "cancelled");
      }
      toast.success(t`已删除`);
      await refresh();
    } catch (error) {
      toast.error(String(error));
    }
  }, [deleteFiles, finishTransfer, pendingDelete, refresh, t]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ToolPageHeader
        title={<Trans>BT 下载</Trans>}
        trailing={
          <Button size="xs" onClick={openAdd}>
            <Plus data-icon="inline-start" />
            <Trans>添加</Trans>
          </Button>
        }
      >
        {tasks.length > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {tasks.length}
          </span>
        ) : null}
      </ToolPageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5 sm:p-3">
        {tasks.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia>
                <Magnet />
              </EmptyMedia>
              <EmptyTitle>
                <Trans>暂无下载任务</Trans>
              </EmptyTitle>
            </EmptyHeader>
            <Button variant="outline" size="sm" onClick={openAdd}>
              <Plus data-icon="inline-start" />
              <Trans>添加</Trans>
            </Button>
          </Empty>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border p-1">
            {tasks.map((task) => {
              const total = task.total ?? 0;
              const progress = task.progress ?? 0;
              const terminal = task.finished || task.status === "Cancelled";
              const percent =
                total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0;
              return (
                <div
                  key={task.infoHash}
                  className="flex flex-col gap-1 rounded-md px-2 py-1.5 text-xs hover:bg-sidebar-accent"
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                      title={task.label}
                      onClick={() => {
                        returnedPreview.current = null;
                        setPrefill(magnetOf(task));
                        setPrefillProbe(null);
                        setDialogOpen(true);
                      }}
                    >
                      {task.label}
                    </button>
                    {task.mode === "preview" ? (
                      <span className="shrink-0 rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">
                        <Trans>在线预览</Trans>
                      </span>
                    ) : null}
                    {task.mode === "preview" && !task.cacheAvailable ? (
                      <span className="shrink-0 rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">
                        <Trans>缓存已清理</Trans>
                      </span>
                    ) : null}
                    {task.status === "Cancelled" ? (
                      <span className="shrink-0 rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">
                        <Trans>已取消</Trans>
                      </span>
                    ) : null}
                    {terminal ? (
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatBytes(total)}
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="shrink-0 tabular-nums text-muted-foreground hover:text-foreground hover:underline"
                          title={t`查看节点明细`}
                          onClick={() => setPeersTask(task)}
                        >
                          {t`节点`} {task.peersLive}
                        </button>
                        <span className="shrink-0 font-medium tabular-nums">
                          {formatBytes(progress)} / {formatBytes(total)}
                        </span>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title={t`磁力链接`}
                      aria-label={t`磁力链接`}
                      onClick={() => setMagnetTask(task)}
                    >
                      <Magnet />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title={t`删除`}
                      aria-label={t`删除`}
                      disabled={task.pinned}
                      onClick={() => {
                        setDeleteFiles(task.mode === "preview");
                        setPendingDelete(task);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {terminal ? null : (
                    <div className="h-0.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <CacheManager onChanged={refresh} />
      </div>

      <TransferPanel animateOnMount={false} />

      <AddTorrentDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) void cleanupReturnedPreview();
        }}
        initialSource={prefill}
        initialProbe={prefillProbe}
        onPreview={(src, file, probe) => void handlePreview(src, file, probe)}
        onAdded={handleAdded}
      />
      <PeersDialog
        task={peersTask ? { infoHash: peersTask.infoHash, label: peersTask.label } : null}
        onClose={() => setPeersTask(null)}
      />

      <Dialog open={magnetTask !== null} onOpenChange={(open) => !open && setMagnetTask(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <Trans>磁力链接</Trans>
            </DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={magnetTask ? magnetOf(magnetTask) : ""} />
            <Button
              variant="outline"
              onClick={async () => {
                if (!magnetTask) return;
                await navigator.clipboard.writeText(magnetOf(magnetTask));
                toast.success(t`已复制`);
              }}
            >
              <Trans>复制</Trans>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete ? t`删除 ${pendingDelete.label}` : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>删除后无法恢复。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDelete?.mode === "preview" ? null : (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={deleteFiles}
                onCheckedChange={(value) => setDeleteFiles(value === true)}
              />
              <Trans>删除文件</Trans>
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t`取消`}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>
              {t`删除`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
