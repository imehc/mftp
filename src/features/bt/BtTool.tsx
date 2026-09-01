import { useEffect, useEffectEvent, useRef, useState } from "react";
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

/** 从 infohash 重建可分享的磁力链接；原始链接不会被保存
 *（引擎保存的是种子本身，而非它来源的 URL）。 */
function magnetOf(task: BtTaskInfo) {
  return `magnet:?xt=urn:btih:${task.infoHash}&dn=${encodeURIComponent(task.label)}`;
}

/**
 * BT 下载页（桌面端）。同时充当历史列表：未完成的任务显示实时进度与
 * 节点，已完成的保留为记录，可复制成磁力链接或删除。在线预览会打开
 * 共享预览页。
 */
export default function BtTool() {
  const { t } = useLingui();
  const navigate = useNavigate();
  // 来自预览页的一次性交接只被消费一次，因此在首次渲染时读取并
  // 初始化状态，而不是用 effect。
  const [handoff] = useState(() => takePreviewLaunch());
  const [dialogOpen, setDialogOpen] = useState(!!handoff);
  const [tasks, setTasks] = useState<BtTaskInfo[]>([]);
  const [peersTask, setPeersTask] = useState<BtTaskInfo | null>(null);
  // 从任务行打开添加对话框时预填的磁力链接；为空表示空白添加流程。
  const [prefill, setPrefill] = useState<string | null>(
    handoff?.source ?? null,
  );
  const [prefillProbe, setPrefillProbe] = useState<BtProbeResult | null>(
    handoff?.probe ?? null,
  );
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
  } | null>(
    handoff
      ? {
          infoHash: handoff.probe.infoHash,
          cleanupCache: !handoff.transferWasVisible,
          preparation: handoff.preparation,
        }
      : null,
  );
  // 已注册到面板中的任务，记录其注册时的特征；既防止轮询产生的
  // 重复注册，又能察觉底层发生变化的任务（见 registerTask）。
  const registered = useRef(new Map<string, string>());
  const registerTask = (task: BtTaskInfo, explicit = false) => {
    // 预览缓存可能转为下载，下载也可能重新添加并选中更多文件。两者都会
    // 改变此特征；而面板行以 id 为键，因此 start() 会替换掉陈旧的行，
    // 而不是把已完成的行遗留在后面。
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
  };
  const registerTaskInEffect = useEffectEvent(registerTask);
  const refresh = async () => {
    try {
      setTasks(await ipc.btList());
    } catch {
      // 懒启动引擎可能失败；保留空状态，而不是崩溃。
      setTasks([]);
    }
  };
  // effect 侧的别名让轮询 / 监听 effect 不会在每次渲染时重跑，
  // 又无需重新引入 useCallback。
  const refreshInEffect = useEffectEvent(refresh);
  useEffect(() => {
    // 用微任务移出 effect 函数体：refresh 只在 await 之后设置状态，
    // 因此挂载时无需同步做任何事。
    queueMicrotask(() => void refreshInEffect());
    const timer = setInterval(() => void refreshInEffect(), 2000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    for (const task of tasks) {
      if (task.status === "Completed" || task.status === "Cancelled") {
        const id = `bt:${task.infoHash}`;
        const transfer = useTransfersStore
          .getState()
          .transfers.find((item) => item.id === id);
        if (transfer?.status === "running") {
          finishTransfer(
            id,
            task.status === "Completed" ? "success" : "cancelled",
          );
        }
        // 清除记忆，使重新启动的任务（以相同文件重新添加到另一个
        // 文件夹）能拿到全新的面板行。
        registered.current.delete(task.infoHash);
      } else {
        registerTaskInEffect(task);
      }
    }
  }, [finishTransfer, tasks]);

  // 转存到本地的结果通过后台监听器的事件到达（未完成的任务要在
  // 下载完成后才通知）。unlisten 句柄异步到达，因此在它解析前运行的
  // 清理必须记得释放它 —— 否则订阅会泄漏，而每次保存会按泄漏次数重复提示。
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | null = null;
    void listen<{
      infoHash: string;
      kind: string;
    }>(BT_TASK_EVENT, (event) => {
      if (event.payload.kind === "saved") {
        toast.success(translate(msg`已转存到本地`));
        registered.current.delete(event.payload.infoHash);
        void refreshInEffect();
      } else if (event.payload.kind.startsWith("save-failed")) {
        toast.error(translate(msg`转存失败`), {
          description: event.payload.kind.slice("save-failed:".length),
        });
        void refreshInEffect();
      } else if (event.payload.kind === "package-completed") {
        finishTransfer(`bt:${event.payload.infoHash}`, "success");
        registered.current.delete(event.payload.infoHash);
        void refreshInEffect();
      } else if (event.payload.kind.startsWith("package-failed:")) {
        finishTransfer(
          `bt:${event.payload.infoHash}`,
          "error",
          event.payload.kind.slice("package-failed:".length),
        );
        void refreshInEffect();
      } else if (event.payload.kind === "removed") {
        registered.current.delete(event.payload.infoHash);
        void refreshInEffect();
      } else if (event.payload.kind === "cancelled") {
        finishTransfer(`bt:${event.payload.infoHash}`, "cancelled");
        registered.current.delete(event.payload.infoHash);
        void refreshInEffect();
      }
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else dispose = unlisten;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [finishTransfer]);

  /** 在线预览：先进入路由；由它准备缓存任务。 */
  const handlePreview = async (
    source: string,
    file: BtFileMeta,
    probe: BtProbeResult,
  ) => {
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
      toast.error(t`在线预览失败`, {
        description: String(error),
      });
      setDialogOpen(true);
    }
  };
  const openAdd = () => {
    returnedPreview.current = null;
    setPrefill(null);
    setPrefillProbe(null);
    setDialogOpen(true);
  };
  const cleanupReturnedPreview = async () => {
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
      toast.error(t`清理预览缓存失败`, {
        description: String(error),
      });
    }
  };
  const handleAdded = (task: BtTaskInfo) => {
    setTasks((current) => [
      task,
      ...current.filter((item) => item.infoHash !== task.infoHash),
    ]);
    registerTask(task, true);
  };
  const confirmDelete = async () => {
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
  };
  const pendingDeleteLabel = pendingDelete?.label;
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
          <div className="border-border flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto rounded-lg border p-1">
            {tasks.map((task) => {
              const total = task.total ?? 0;
              const progress = task.progress ?? 0;
              const terminal = task.finished || task.status === "Cancelled";
              const percent =
                total > 0
                  ? Math.min(100, Math.round((progress / total) * 100))
                  : 0;
              return (
                <div
                  key={task.infoHash}
                  className="hover:bg-sidebar-accent flex flex-col gap-1 rounded-md px-2 py-1.5 text-xs"
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
                      <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1 py-px text-[10px]">
                        <Trans>在线预览</Trans>
                      </span>
                    ) : null}
                    {task.mode === "preview" && !task.cacheAvailable ? (
                      <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1 py-px text-[10px]">
                        <Trans>缓存已清理</Trans>
                      </span>
                    ) : null}
                    {task.status === "Cancelled" ? (
                      <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1 py-px text-[10px]">
                        <Trans>已取消</Trans>
                      </span>
                    ) : null}
                    {terminal ? (
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {formatBytes(total)}
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground shrink-0 tabular-nums hover:underline"
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
                    <div className="bg-muted h-0.5 overflow-hidden rounded-full">
                      <div
                        className="bg-primary h-full rounded-full transition-[width]"
                        style={{
                          width: `${percent}%`,
                        }}
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
        task={
          peersTask
            ? {
                infoHash: peersTask.infoHash,
                label: peersTask.label,
              }
            : null
        }
        onClose={() => setPeersTask(null)}
      />

      <Dialog
        open={magnetTask !== null}
        onOpenChange={(open) => !open && setMagnetTask(null)}
      >
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
              {pendingDelete ? t`删除 ${pendingDeleteLabel}` : ""}
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
