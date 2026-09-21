import { useEffect, useEffectEvent, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { Magnet, Plus } from "lucide-react";
import { toast } from "sonner";
import * as ipc from "~/lib/ipc";
import type { BtProbeResult, BtTaskInfo } from "~/types";
import { useTransfersStore } from "~/store/transfers";
import TransferPanel from "~/features/transfers/TransferPanel";
import { BT_TASK_EVENT } from "~/lib/events";
import { canPlayInline, isPreviewable, previewKind } from "~/lib/preview-kind";
import { isMobilePlatform } from "~/lib/platform";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import AddTorrentDialog from "./components/AddTorrentDialog";
import PeersDialog from "./components/PeersDialog";
import TaskDialogs from "./components/TaskDialogs";
import TaskRow from "./components/TaskRow";
import { systemDownloadDir } from "./file-actions";

const SHARE_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
];
const NO_PEER_HINT_DELAY = 15000;

function magnetOf(task: BtTaskInfo) {
  const trackers = SHARE_TRACKERS.map(
    (tracker) => `&tr=${encodeURIComponent(tracker)}`,
  ).join("");
  return `magnet:?xt=urn:btih:${task.infoHash}&dn=${encodeURIComponent(task.label)}${trackers}`;
}

export default function BtTool() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tasks, setTasks] = useState<BtTaskInfo[]>([]);
  const [previewReady, setPreviewReady] = useState<Set<string>>(new Set());
  const [parsedHashes, setParsedHashes] = useState<Set<string>>(new Set());
  const parsedProbes = useRef(
    new Map<
      string,
      { source: string; probe: BtProbeResult; fileIndices: number[] }
    >(),
  );
  const [peersTask, setPeersTask] = useState<BtTaskInfo | null>(null);
  const [noPeers, setNoPeers] = useState<Set<string>>(new Set());
  const zeroPeersSince = useRef(new Map<string, number>());
  const [prefill, setPrefill] = useState<string | null>(null);
  const [prefillProbe, setPrefillProbe] = useState<BtProbeResult | null>(null);
  const [prefillSelected, setPrefillSelected] = useState<number[] | null>(null);
  const [dialogReadOnly, setDialogReadOnly] = useState(false);
  const [magnetTask, setMagnetTask] = useState<BtTaskInfo | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BtTaskInfo | null>(null);
  const startTransfer = useTransfersStore((s) => s.start);
  const restoreTransfer = useTransfersStore((s) => s.restore);
  const finishTransfer = useTransfersStore((s) => s.finish);
  const updateProgressBatch = useTransfersStore((s) => s.updateProgressBatch);
  const registered = useRef(new Map<string, string>());

  const openPrefilled = (magnet: string) => {
    setPrefill(magnet);
    setPrefillProbe(null);
    setPrefillSelected(null);
    setDialogReadOnly(false);
    setDialogOpen(true);
  };
  const registerTask = (task: BtTaskInfo, explicit = false) => {
    const id = `bt:${task.infoHash}`;
    const signature = task.packageMode;
    const current = useTransfersStore
      .getState()
      .transfers.find((item) => item.id === id);
    const changed = registered.current.get(task.infoHash) !== signature;
    const shouldStart = explicit
      ? changed || !current || current.status !== "running"
      : (task.state === "Downloading" || task.status === "Packaging") &&
        (changed || !current);
    if (shouldStart) {
      registered.current.set(task.infoHash, signature);
      (explicit ? startTransfer : restoreTransfer)(id, task.label, {
        cancellable: true,
        source: "bt",
        retry: () => openPrefilled(magnetOf(task)),
      });
    }
    if (task.status === "Packaging") {
      updateProgressBatch([
        {
          id,
          phase: "bt:packaging",
          transferred: task.progress ?? 0,
          total: task.total ?? null,
          finished: false,
        },
      ]);
    } else if (task.status === "Error")
      finishTransfer(id, "error", task.error ?? undefined);
  };
  const registerTaskInEffect = useEffectEvent(registerTask);
  const trackStalledPeers = (list: BtTaskInfo[]) => {
    const now = Date.now();
    const stalled = new Set<string>();
    for (const task of list) {
      if (task.state !== "Downloading" || task.peersLive > 0) {
        zeroPeersSince.current.delete(task.infoHash);
        continue;
      }
      const since = zeroPeersSince.current.get(task.infoHash) ?? now;
      zeroPeersSince.current.set(task.infoHash, since);
      if (now - since >= NO_PEER_HINT_DELAY) stalled.add(task.infoHash);
    }
    setNoPeers((prev) =>
      prev.size === stalled.size && [...stalled].every((hash) => prev.has(hash))
        ? prev
        : stalled,
    );
  };
  const refreshPreviewReadiness = async (list: BtTaskInfo[]) => {
    const candidates = list.filter((task) => {
      if (task.status !== "Active" || task.fileIndex == null || !task.fileName)
        return false;
      const kind = previewKind(task.fileName);
      return isPreviewable(kind) && canPlayInline(task.fileName, kind);
    });
    const probeTasks = candidates.filter((task) => task.state !== "Paused");
    const results = await Promise.allSettled(
      probeTasks.map((task) =>
        ipc.btPlayability(task.infoHash, task.fileIndex!, false),
      ),
    );
    setPreviewReady((current) => {
      const next = new Set<string>();
      for (const task of candidates) {
        if (task.state === "Paused" && current.has(task.infoHash))
          next.add(task.infoHash);
      }
      results.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value.ready)
          next.add(probeTasks[index].infoHash);
        else if (
          result.status === "rejected" &&
          current.has(probeTasks[index].infoHash)
        )
          next.add(probeTasks[index].infoHash);
      });
      return next;
    });
  };
  const refresh = async () => {
    try {
      const list = await ipc.btList();
      setTasks(list);
      trackStalledPeers(list);
      void refreshPreviewReadiness(list);
    } catch {
      setTasks([]);
      setPreviewReady(new Set());
    }
  };
  const refreshInEffect = useEffectEvent(refresh);
  useEffect(() => {
    queueMicrotask(() => void refreshInEffect());
    const timer = setInterval(() => void refreshInEffect(), 2000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    for (const task of tasks) {
      const id = `bt:${task.infoHash}`;
      if (task.status === "Completed" || task.status === "Cancelled") {
        if (
          useTransfersStore.getState().transfers.find((item) => item.id === id)
            ?.status === "running"
        )
          finishTransfer(
            id,
            task.status === "Completed" ? "success" : "cancelled",
          );
        registered.current.delete(task.infoHash);
      } else registerTaskInEffect(task);
    }
  }, [finishTransfer, tasks]);
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | null = null;
    void listen<{ infoHash: string; kind: string }>(BT_TASK_EVENT, (event) => {
      if (event.payload.kind === "package-completed")
        finishTransfer(`bt:${event.payload.infoHash}`, "success");
      else if (event.payload.kind.startsWith("package-failed:"))
        finishTransfer(
          `bt:${event.payload.infoHash}`,
          "error",
          event.payload.kind.slice("package-failed:".length),
        );
      else if (event.payload.kind === "cancelled")
        finishTransfer(`bt:${event.payload.infoHash}`, "cancelled");
      registered.current.delete(event.payload.infoHash);
      void refreshInEffect();
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else dispose = unlisten;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [finishTransfer]);

  const openAdd = () => {
    setPrefill(null);
    setPrefillProbe(null);
    setPrefillSelected(null);
    setDialogReadOnly(false);
    setDialogOpen(true);
  };
  const handleAdded = (
    task: BtTaskInfo,
    source: string,
    probe: BtProbeResult,
    fileIndices: number[],
  ) => {
    parsedProbes.current.set(task.infoHash, { source, probe, fileIndices });
    setParsedHashes((current) => {
      const next = new Set(current);
      next.add(task.infoHash);
      return next;
    });
    setTasks((current) => [
      task,
      ...current.filter((item) => item.infoHash !== task.infoHash),
    ]);
    registerTask(task, true);
  };
  const openParsed = (task: BtTaskInfo) => {
    const parsed = parsedProbes.current.get(task.infoHash);
    if (!parsed) return;
    setPrefill(parsed.source);
    setPrefillProbe(parsed.probe);
    setPrefillSelected(parsed.fileIndices);
    setDialogReadOnly(true);
    setDialogOpen(true);
  };
  const control = async (
    task: BtTaskInfo,
    action: "Pause" | "Resume" | "Cancel",
  ) => {
    try {
      await ipc.btControl(task.infoHash, action, false);
      const id = `bt:${task.infoHash}`;
      if (action === "Cancel") {
        registered.current.delete(task.infoHash);
        finishTransfer(id, "cancelled");
      } else useTransfersStore.getState().setPaused(id, action === "Pause");
      await refresh();
    } catch (error) {
      toast.error(String(error));
    }
  };
  const exportTask = async (task: BtTaskInfo) => {
    if (isMobilePlatform()) {
      try {
        await ipc.btExport(task.infoHash, "");
        toast.success(t`已复制到系统下载目录`);
        await refresh();
      } catch (error) {
        toast.error(t`转存失败`, { description: String(error) });
      }
      return;
    }
    const defaultPath = await systemDownloadDir();
    const picked = await openDialog({
      multiple: false,
      directory: true,
      defaultPath: defaultPath || undefined,
    });
    if (typeof picked !== "string") return;
    try {
      await ipc.btExport(task.infoHash, picked);
      toast.success(t`已复制到用户目录`);
      await refresh();
    } catch (error) {
      toast.error(t`转存失败`, { description: String(error) });
    }
  };
  const openLocation = async (task: BtTaskInfo) => {
    const location =
      (task.exported && task.exportPath) || task.outputPath || task.downloadDir;
    if (!location) return;
    try {
      await revealItemInDir(location);
    } catch {
      try {
        await openPath(location);
      } catch (error) {
        toast.error(t`无法打开下载位置`, { description: String(error) });
      }
    }
  };
  const previewTask = async (task: BtTaskInfo) => {
    let url: string | null = null;
    let name = task.label;
    if (task.status === "Completed") {
      const path = (task.exported && task.exportPath) || task.outputPath;
      if (!path || !isPreviewable(previewKind(path))) return;
      url = convertFileSrc(path);
      name = path.split(/[\\/]/).pop() || task.label;
    } else if (task.fileIndex != null) {
      try {
        const state = await ipc.btPlayability(
          task.infoHash,
          task.fileIndex,
          true,
        );
        if (!state.supported) {
          toast.info(t`该文件格式不支持渐进预览`, {
            description: state.fileName,
          });
          return;
        }
        if (!state.ready || !state.url) {
          toast.info(t`播放窗口尚未就绪`, {
            description: state.reason ?? t`请稍后重试`,
          });
          return;
        }
        url = state.url;
        name = state.fileName;
      } catch (error) {
        toast.error(t`无法开始预览`, { description: String(error) });
        return;
      }
    }
    if (!url || !isPreviewable(previewKind(name))) return;
    void navigate({
      to: "/preview",
      search: {
        name,
        kind: previewKind(name),
        url,
      },
    });
  };
  const activeTasks = tasks.filter((task) => task.status !== "Completed");
  const completedTasks = tasks.filter((task) => task.status === "Completed");
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await ipc.btControl(target.infoHash, "Remove", true);
      registered.current.delete(target.infoHash);
      finishTransfer(`bt:${target.infoHash}`, "cancelled");
      toast.success(t`已删除`);
      await refresh();
    } catch (error) {
      toast.error(String(error));
    }
  };
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
          <span className="text-muted-foreground text-xs tabular-nums">
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
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            <section className="border-border shrink-0 rounded-lg border p-1">
              <h2 className="text-muted-foreground px-2 py-1 text-xs font-medium">
                <Trans>下载中</Trans>
                <span className="ml-1 tabular-nums">{activeTasks.length}</span>
              </h2>
              {activeTasks.length > 0 ? (
                activeTasks.map((task) => (
                  <TaskRow
                    key={task.infoHash}
                    task={task}
                    stalled={noPeers.has(task.infoHash)}
                    previewReady={previewReady.has(task.infoHash)}
                    hasParsedProbe={parsedHashes.has(task.infoHash)}
                    onOpenParsed={openParsed}
                    onRetry={(item) => openPrefilled(magnetOf(item))}
                    onPeers={setPeersTask}
                    onControl={(item, action) => void control(item, action)}
                    onMagnet={setMagnetTask}
                    onExport={(item) => void exportTask(item)}
                    onOpenLocation={(item) => void openLocation(item)}
                    onPreview={previewTask}
                    onDelete={(item) => {
                      setPendingDelete(item);
                    }}
                  />
                ))
              ) : (
                <p className="text-muted-foreground px-2 py-3 text-xs">
                  <Trans>暂无下载中的任务</Trans>
                </p>
              )}
            </section>
            <section className="border-border shrink-0 rounded-lg border p-1">
              <h2 className="text-muted-foreground px-2 py-1 text-xs font-medium">
                <Trans>已完成</Trans>
                <span className="ml-1 tabular-nums">
                  {completedTasks.length}
                </span>
              </h2>
              {completedTasks.length > 0 ? (
                completedTasks.map((task) => (
                  <TaskRow
                    key={task.infoHash}
                    task={task}
                    stalled={false}
                    previewReady={false}
                    hasParsedProbe={parsedHashes.has(task.infoHash)}
                    onOpenParsed={openParsed}
                    onRetry={(item) => openPrefilled(magnetOf(item))}
                    onPeers={setPeersTask}
                    onControl={(item, action) => void control(item, action)}
                    onMagnet={setMagnetTask}
                    onExport={(item) => void exportTask(item)}
                    onOpenLocation={(item) => void openLocation(item)}
                    onPreview={previewTask}
                    onDelete={(item) => {
                      setPendingDelete(item);
                    }}
                  />
                ))
              ) : (
                <p className="text-muted-foreground px-2 py-3 text-xs">
                  <Trans>暂无已完成任务</Trans>
                </p>
              )}
            </section>
          </div>
        )}
      </div>
      <TransferPanel animateOnMount={false} />
      <AddTorrentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialSource={prefill}
        initialProbe={prefillProbe}
        initialSelected={prefillSelected}
        readOnly={dialogReadOnly}
        existingInfoHashes={new Set(tasks.map((task) => task.infoHash))}
        allowExistingTask={prefill != null && prefillProbe == null}
        onAdded={handleAdded}
      />
      <PeersDialog
        task={
          peersTask
            ? { infoHash: peersTask.infoHash, label: peersTask.label }
            : null
        }
        onClose={() => setPeersTask(null)}
      />
      <TaskDialogs
        magnetText={magnetTask ? magnetOf(magnetTask) : null}
        onCloseMagnet={() => setMagnetTask(null)}
        pendingDeleteLabel={pendingDelete?.label ?? null}
        onCloseDelete={() => setPendingDelete(null)}
        onConfirmDelete={() => void confirmDelete()}
      />
    </div>
  );
}
