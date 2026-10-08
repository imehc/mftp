import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, Magnet, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ToolPageHeader } from "~/components/ToolPageHeader";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import ActivityMenu from "~/features/transfers/ActivityMenu";
import { describeError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import { isMobilePlatform } from "~/lib/platform";
import { useTransfersStore } from "~/store/transfers";
import type { BtProbeResult, BtTaskInfo } from "~/types";

import AddTorrentDialog from "./components/AddTorrentDialog";
import TaskDialogs from "./components/TaskDialogs";
import TaskFilesPage from "./components/TaskFilesPage";
import TaskList from "./components/TaskList";
import { systemDownloadDir } from "./file-actions";
import { magnetOf } from "./magnet";
import { acquireBtPage, retryBtSubscription } from "./runtime/btRuntime";
import { forgetBtTask, syncBtTask } from "./task-sync";
import { refreshBtTasks, useBtTasksStore } from "./tasks-store";

export default function BtTool() {
  const { t } = useLingui();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filesTask, setFilesTask] = useState<BtTaskInfo | null>(null);
  const [parsedHashes, setParsedHashes] = useState<Set<string>>(new Set());
  const parsedProbes = useRef(
    new Map<
      string,
      { source: string; probe: BtProbeResult; fileIndices: number[] }
    >(),
  );
  const [filesTab, setFilesTab] = useState("files");
  const [busyTasks, setBusyTasks] = useState<Set<string>>(new Set());
  const pendingActions = useRef(new Set<string>());

  const openFiles = (task: BtTaskInfo, tab = "files") => {
    setFilesTab(tab);
    setFilesTask(task);
  };

  const runAction = async (hash: string, action: () => Promise<void>) => {
    if (pendingActions.current.has(hash)) return;
    pendingActions.current.add(hash);
    setBusyTasks(new Set(pendingActions.current));
    try {
      await action();
    } finally {
      pendingActions.current.delete(hash);
      setBusyTasks(new Set(pendingActions.current));
    }
  };

  const [prefill, setPrefill] = useState<string | null>(null);
  const [prefillProbe, setPrefillProbe] = useState<BtProbeResult | null>(null);
  const [prefillSelected, setPrefillSelected] = useState<number[] | null>(null);
  const [dialogReadOnly, setDialogReadOnly] = useState(false);
  const [magnetTask, setMagnetTask] = useState<BtTaskInfo | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BtTaskInfo | null>(null);
  const finishTransfer = useTransfersStore((s) => s.finish);
  const tasks = useBtTasksStore((s) => s.tasks);
  const setTasks = useBtTasksStore((s) => s.setTasks);
  const loading = useBtTasksStore((s) => s.loading);
  const loadError = useBtTasksStore((s) => s.error);
  const subscriptionError = useBtTasksStore((s) => s.subscriptionError);
  const pendingAddSource = useBtTasksStore((s) => s.pendingAddSource);
  const consumeAddSource = useBtTasksStore((s) => s.consumeAddSource);
  const noPeers = useBtTasksStore((s) => s.noPeers);

  const openPrefilled = (magnet: string) => {
    setPrefill(magnet);
    setPrefillProbe(null);
    setPrefillSelected(null);
    setDialogReadOnly(false);
    setDialogOpen(true);
  };

  // 页面挂载期间申请 2s 级轮询；任务同步、无对等节点提示都由模块运行期负责。
  useEffect(() => acquireBtPage(), []);
  const refresh = refreshBtTasks;

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
    setTasks([
      task,
      ...useBtTasksStore
        .getState()
        .tasks.filter((item) => item.infoHash !== task.infoHash),
    ]);
    // 新加入的任务立刻进入传输面板，不等下一次轮询。
    syncBtTask(task, true);
    void refresh();
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
        forgetBtTask(task.infoHash);
        finishTransfer(id, "cancelled");
      } else useTransfersStore.getState().setPaused(id, action === "Pause");
      await refresh();
    } catch (error) {
      toast.error(describeError(error));
    }
  };

  const exportTask = async (task: BtTaskInfo) => {
    if (isMobilePlatform()) {
      try {
        await ipc.btExport(task.infoHash, "");
        toast.success(t`已复制到系统下载目录`);
        await refresh();
      } catch (error) {
        toast.error(t`转存失败`, { description: describeError(error) });
      }
      return;
    }
    try {
      const defaultPath = await systemDownloadDir();
      const picked = await openDialog({
        multiple: false,
        directory: true,
        defaultPath: defaultPath || undefined,
      });
      if (typeof picked !== "string") return;
      await ipc.btExport(task.infoHash, picked);
      toast.success(t`已复制到用户目录`);
      await refresh();
    } catch (error) {
      toast.error(t`转存失败`, { description: describeError(error) });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await ipc.btControl(target.infoHash, "Remove", true);
      forgetBtTask(target.infoHash);
      finishTransfer(`bt:${target.infoHash}`, "cancelled");
      toast.success(t`已删除`);
      await refresh();
    } catch (error) {
      toast.error(describeError(error));
    }
  };

  return (
    <div
      data-bottom-inset="scroll"
      className="ui-density-adaptive flex h-full min-h-0 flex-col"
    >
      <div className={filesTask ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <ToolPageHeader
          showHome={false}
          status={<ActivityMenu />}
          leading={
            <Button variant="ghost" size="icon-sm" asChild>
              <Link
                to="/"
                search={{ category: "tools" }}
                aria-label={t`返回首页`}
              >
                <ArrowLeft />
              </Link>
            </Button>
          }
          title={<Trans>BT 下载</Trans>}
          trailing={
            <Button
              variant="ghost"
              density="adaptive"
              size="icon-sm"
              aria-label={t`添加`}
              onClick={openAdd}
            >
              <Plus data-icon="inline-start" />
            </Button>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-2.5 pt-2.5 md:px-3 md:pt-3">
          {loadError || subscriptionError ? (
            <Alert variant="destructive">
              <AlertTitle>
                {loadError ? (
                  <Trans>无法读取下载任务</Trans>
                ) : (
                  <Trans>任务状态通知暂不可用</Trans>
                )}
              </AlertTitle>
              <AlertDescription>
                {describeError(loadError ?? subscriptionError)}
              </AlertDescription>
              <AlertAction>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    // 重新建立事件监听；读取本来就会在期间自愈。
                    if (subscriptionError) retryBtSubscription();
                    void refresh();
                  }}
                >
                  <Trans comment="重新读取 BT 下载任务；通知监听失败时也会重新连接监听">
                    重试
                  </Trans>
                </Button>
              </AlertAction>
            </Alert>
          ) : null}
          {loading ? (
            <p role="status" className="text-muted-foreground text-sm">
              <Trans>加载中…</Trans>
            </p>
          ) : null}
          {tasks.length === 0 && !loading && !loadError ? (
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
          ) : tasks.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-3 py-1 text-xs">
                <h2 className="font-semibold">
                  <Trans>全部任务</Trans>
                </h2>
                <span className="text-muted-foreground tabular-nums">
                  {tasks.length}
                </span>
              </div>
              <TaskList
                tasks={tasks}
                rowProps={(task) => ({
                  busy: busyTasks.has(task.infoHash),
                  stalled: noPeers.has(task.infoHash),
                  hasParsedProbe: parsedHashes.has(task.infoHash),
                  onOpenParsed: openParsed,
                  onRetry: (item) => openPrefilled(magnetOf(item)),
                  onPeers: (item) => openFiles(item, "peers"),
                  onControl: (item, action) =>
                    void runAction(item.infoHash, () => control(item, action)),
                  onMagnet: setMagnetTask,
                  onExport: (item) =>
                    void runAction(item.infoHash, () => exportTask(item)),
                  onOpenFiles: (item) => openFiles(item),
                  onDelete: setPendingDelete,
                })}
              />
            </>
          ) : null}
        </div>
      </div>
      {filesTask ? (
        <TaskFilesPage
          key={filesTask.infoHash}
          task={
            tasks.find((task) => task.infoHash === filesTask.infoHash) ??
            filesTask
          }
          initialTab={filesTab}
          onClose={() => setFilesTask(null)}
          onExport={() =>
            void runAction(filesTask.infoHash, () => exportTask(filesTask))
          }
          busy={busyTasks.has(filesTask.infoHash)}
        />
      ) : null}
      <AddTorrentDialog
        open={dialogOpen || pendingAddSource !== null}
        onOpenChange={(open) => {
          setDialogOpen(open);
          // 关闭即消费：跨页面重试意图只打开一次对话框。
          if (!open) consumeAddSource();
        }}
        initialSource={prefill ?? pendingAddSource}
        initialProbe={prefillProbe}
        initialSelected={prefillSelected}
        readOnly={dialogReadOnly}
        existingInfoHashes={new Set(tasks.map((task) => task.infoHash))}
        allowExistingTask={
          (prefill ?? pendingAddSource) != null && prefillProbe == null
        }
        onAdded={handleAdded}
      />
      <TaskDialogs
        magnetText={magnetTask ? magnetOf(magnetTask) : null}
        onCloseMagnet={() => setMagnetTask(null)}
        pendingDeleteLabel={pendingDelete?.label ?? null}
        onCloseDelete={() => setPendingDelete(null)}
        onConfirmDelete={() => {
          if (pendingDelete)
            void runAction(pendingDelete.infoHash, confirmDelete);
        }}
      />
    </div>
  );
}
