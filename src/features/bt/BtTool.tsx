import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowLeft, Magnet, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import AppPageContent from "~/components/AppPageContent";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { BackLink } from "~/features/navigation/BackLink";
import { describeError } from "~/lib/errors";
import type { BtProbeResult, BtTaskInfo } from "~/types";

import AddTorrentDialog from "./components/AddTorrentDialog";
import TaskDialogs from "./components/TaskDialogs";
import TaskFilesPage from "./components/TaskFilesPage";
import TaskList from "./components/TaskList";
import { magnetOf } from "./magnet";
import { acquireBtPage, retryBtSubscription } from "./runtime/btRuntime";
import { syncBtTask } from "./task-sync";
import { refreshBtTasks, useBtTasksStore } from "./tasks-store";
import { useBtTaskActions } from "./use-task-actions";

interface ParsedTorrent {
  source: string;
  probe: BtProbeResult;
  fileIndices: number[];
}

type TorrentDialog =
  | { mode: "add"; source: string | null }
  | { mode: "parsed"; draft: ParsedTorrent };

export default function BtTool() {
  const { t } = useLingui();
  const [dialog, setDialog] = useState<TorrentDialog | null>(null);
  const [filesTask, setFilesTask] = useState<BtTaskInfo | null>(null);
  const [filesTab, setFilesTab] = useState("files");
  const [parsedProbes, setParsedProbes] = useState(
    new Map<string, ParsedTorrent>(),
  );
  const { busyTasks, control, remove, exportTask } = useBtTaskActions();

  const openFiles = (task: BtTaskInfo, tab = "files") => {
    setFilesTab(tab);
    setFilesTask(task);
  };

  const [magnetTask, setMagnetTask] = useState<BtTaskInfo | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BtTaskInfo | null>(null);
  const [pendingCancel, setPendingCancel] = useState<BtTaskInfo | null>(null);
  const tasks = useBtTasksStore((s) => s.tasks);
  const setTasks = useBtTasksStore((s) => s.setTasks);
  const loading = useBtTasksStore((s) => s.loading);
  const loadError = useBtTasksStore((s) => s.error);
  const subscriptionError = useBtTasksStore((s) => s.subscriptionError);
  const pendingAddSource = useBtTasksStore((s) => s.pendingAddSource);
  const consumeAddSource = useBtTasksStore((s) => s.consumeAddSource);
  const noPeers = useBtTasksStore((s) => s.noPeers);

  const openPrefilled = (source: string) => setDialog({ mode: "add", source });
  const openAdd = () => setDialog({ mode: "add", source: null });
  const draft = dialog?.mode === "parsed" ? dialog.draft : null;
  const source =
    dialog?.mode === "add"
      ? dialog.source
      : (draft?.source ?? pendingAddSource);

  // 页面挂载期间申请 2s 级轮询；任务同步由模块运行期负责。
  useEffect(() => acquireBtPage(), []);
  const refresh = refreshBtTasks;

  const handleAdded = (
    task: BtTaskInfo,
    source: string,
    probe: BtProbeResult,
    fileIndices: number[],
  ) => {
    setParsedProbes((current) =>
      new Map(current).set(task.infoHash, { source, probe, fileIndices }),
    );
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
    const draft = parsedProbes.get(task.infoHash);
    if (draft) setDialog({ mode: "parsed", draft });
  };

  return (
    <div
      data-bottom-inset="scroll"
      className="ui-density-adaptive flex h-full min-h-0 flex-col"
    >
      <div className={filesTask ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <ToolPageHeader
          variant="standard"
          showHome={false}
          leading={
            <Button variant="ghost" size="icon-sm" asChild>
              <BackLink
                to="/"
                search={{ category: "tools" }}
                aria-label={t`返回首页`}
              >
                <ArrowLeft />
              </BackLink>
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
        <AppPageContent
          scroll="content"
          density="compact"
          bottomInset="scroll"
          className="min-h-0 flex-1"
        >
          {loadError ? (
            <Alert variant="destructive">
              <AlertTitle>
                <Trans>无法读取下载任务</Trans>
              </AlertTitle>
              <AlertDescription>{describeError(loadError, t)}</AlertDescription>
              <AlertAction>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => void refresh()}
                >
                  <Trans comment="重新读取 BT 下载任务">重试</Trans>
                </Button>
              </AlertAction>
            </Alert>
          ) : null}
          {subscriptionError ? (
            <Alert variant="destructive">
              <AlertTitle>
                <Trans>任务状态通知暂不可用</Trans>
              </AlertTitle>
              <AlertDescription>
                {describeError(subscriptionError, t)}
              </AlertDescription>
              <AlertAction>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={retryBtSubscription}
                >
                  <Trans comment="重新建立 BT 任务状态事件监听">重试</Trans>
                </Button>
              </AlertAction>
            </Alert>
          ) : null}
          {loading ? (
            <div
              role="status"
              className="text-muted-foreground flex items-center gap-2 text-sm"
            >
              <Spinner aria-label={t`加载中`} />
              <Trans>加载中…</Trans>
            </div>
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
                <Badge variant="outline" className="tabular-nums">
                  {tasks.length}
                </Badge>
              </div>
              <TaskList
                tasks={tasks}
                rowProps={(task) => ({
                  busy: busyTasks.has(task.infoHash),
                  stalled: noPeers.has(task.infoHash),
                  hasParsedProbe: parsedProbes.has(task.infoHash),
                  onOpenParsed: openParsed,
                  onRetry: (item) => openPrefilled(magnetOf(item)),
                  onPeers: (item) => openFiles(item, "peers"),
                  onControl: (item, action) => {
                    if (action === "Cancel") setPendingCancel(item);
                    else void control(item, action);
                  },
                  onMagnet: setMagnetTask,
                  onExport: (item) => void exportTask(item),
                  onOpenFiles: (item) => openFiles(item),
                  onDelete: setPendingDelete,
                })}
              />
            </>
          ) : null}
        </AppPageContent>
      </div>
      {filesTask ? (
        <TaskFilesPage
          key={`${filesTask.infoHash}:${filesTab}`}
          task={
            tasks.find((task) => task.infoHash === filesTask.infoHash) ??
            filesTask
          }
          initialTab={filesTab}
          onClose={() => setFilesTask(null)}
          onExport={() => void exportTask(filesTask)}
          busy={busyTasks.has(filesTask.infoHash)}
        />
      ) : null}
      <AddTorrentDialog
        open={dialog !== null || pendingAddSource !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
          // 关闭即消费：跨页面重试意图只打开一次对话框。
          if (!open) consumeAddSource();
        }}
        initialSource={source}
        initialProbe={draft?.probe}
        initialSelected={draft?.fileIndices}
        readOnly={dialog?.mode === "parsed"}
        existingInfoHashes={new Set(tasks.map((task) => task.infoHash))}
        allowExistingTask={source != null && draft === null}
        onAdded={handleAdded}
      />
      <TaskDialogs
        magnetText={magnetTask ? magnetOf(magnetTask) : null}
        onCloseMagnet={() => setMagnetTask(null)}
        pendingDeleteLabel={pendingDelete?.label ?? null}
        onCloseDelete={() => setPendingDelete(null)}
        onConfirmDelete={() => {
          if (pendingDelete) void remove(pendingDelete);
          setPendingDelete(null);
        }}
        pendingCancelLabel={pendingCancel?.label ?? null}
        onCloseCancel={() => setPendingCancel(null)}
        onConfirmCancel={() => {
          if (pendingCancel) void control(pendingCancel, "Cancel");
        }}
      />
    </div>
  );
}
