import { useEffect, useEffectEvent, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowDownToLine,
  BookMarked,
  ChevronRight,
  FolderInput,
  LoaderCircle,
  ScrollText,
  Trash2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
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
  poetryAnnotationsDelete,
  poetryAnnotationsInstall,
  poetryAnnotationsStatus,
  poetryCollectionDelete,
  poetryCollections,
  poetryContentIndexBuild,
  poetryContentIndexStatus,
  poetrySyncCancel,
  poetrySyncImportLocal,
  poetrySyncStart,
} from "~/lib/ipc";
import { formatBytes } from "~/lib/format";
import type {
  PoetryCollectionStatus,
  PoetryContentIndexStatus,
  PoetryTier,
} from "~/types";
import { usePoetrySyncProgress } from "./hooks/use-poetry-sync";
import { usePoetryStore } from "./store/poetry-store";
const TIER_ORDER: PoetryTier[] = ["recommended", "default", "optIn"];
const SYNC_TOAST_ID = "poetry-sync";
const INDEX_TOAST_ID = "poetry-index";
function useTierLabels(): Record<PoetryTier, string> {
  const { t } = useLingui();
  return {
    recommended: t`推荐`,
    default: t`默认`,
    optIn: t`可选`,
  };
}

/** 每个合集一行紧凑展示：复选框（待安装）/ 统计 / 删除。 */
function CollectionRow({
  status,
  busy,
  progressLabel,
  selected,
  onToggle,
  onDelete,
}: {
  status: PoetryCollectionStatus;
  busy: boolean;
  progressLabel?: string;
  selected?: boolean;
  onToggle?: () => void;
  onDelete: (status: PoetryCollectionStatus) => void;
}) {
  const { t } = useLingui();
  const tierLabels = useTierLabels();
  const meta = status.installed
    ? `${status.poemCount.toLocaleString()} 篇 · ${formatBytes(Math.max(0, status.bytesUsed))}`
    : `${status.dynasty} · ${tierLabels[status.tier]}`;
  const statusName = status.name;
  return (
    <label className="hover:bg-accent/50 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors">
      {!status.installed ? (
        <Checkbox
          checked={selected ?? false}
          disabled={busy}
          onCheckedChange={() => onToggle?.()}
          aria-label={`${t`选择`}：${status.name}`}
          className="mx-0.5"
        />
      ) : (
        <span className="mx-0.5 w-4" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm">{status.name}</span>
          <span className="text-muted-foreground shrink-0 text-xs">
            {busy && progressLabel ? progressLabel : meta}
          </span>
        </span>
      </span>
      {status.installed ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t`卸载 ${statusName}`}
          disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            onDelete(status);
          }}
        >
          <Trash2 className="text-muted-foreground hover:text-destructive" />
        </Button>
      ) : null}
    </label>
  );
}
export default function LibraryManagePage() {
  const { t } = useLingui();
  const collections = usePoetryStore((s) => s.collections);
  const setCollections = usePoetryStore((s) => s.setCollections);
  const progress = usePoetrySyncProgress();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [bodyIndex, setBodyIndex] = useState<PoetryContentIndexStatus | null>(
    null,
  );
  const [annotationsCount, setAnnotationsCount] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<PoetryCollectionStatus | null>(null);
  const [installedOpen, setInstalledOpen] = useState(false);
  const refresh = async () => {
    try {
      setCollections(await poetryCollections());
      setBodyIndex(await poetryContentIndexStatus().catch(() => null));
      setAnnotationsCount(
        (await poetryAnnotationsStatus().catch(() => null))?.entryCount ?? 0,
      );
    } catch (error) {
      toast.error(t`读取失败`, {
        description: String(error),
      });
    }
  };

  // 初次加载；终态阶段刷新卡片并弹出提示。
  // 用微任务延后，使 setState 发生在 effect 函数体之外；refresh 通过
  // effect event 读取，因为它每次渲染都会重新定义。
  const refreshInEffect = useEffectEvent(refresh);
  useEffect(() => {
    queueMicrotask(() => void refreshInEffect());
  }, []);

  // 用固定 id 的 toast 展示实时进度，仿照更新器的流程：加载中
  // 就地更新，终态的成功 / 失败再替换它。
  useEffect(() => {
    // 正文索引事件在下方有自己独立的 toast 生命周期。
    if (progress.collectionId === "body-index") return;
    if (progress.phase === "downloading") {
      toast.loading(t`正在下载语料`, {
        id: SYNC_TOAST_ID,
        description: `${formatBytes(progress.bytesDone)}${progress.bytesTotal ? ` / ${formatBytes(progress.bytesTotal)}` : ""}`,
        duration: Number.POSITIVE_INFINITY,
      });
    } else if (
      progress.phase === "importing" ||
      progress.phase === "indexing"
    ) {
      toast.loading(t`正在导入语料`, {
        id: SYNC_TOAST_ID,
        description: `${t`已导入`} ${progress.imported.toLocaleString()}${progress.total ? ` / ${progress.total.toLocaleString()}` : ""}`,
        duration: Number.POSITIVE_INFINITY,
      });
    } else if (progress.phase === "done") {
      toast.success(t`同步完成`, {
        id: SYNC_TOAST_ID,
        duration: 4000,
      });
      // 用微任务延后，使 setState 发生在 effect 函数体之外。
      queueMicrotask(() => void refreshInEffect());
    } else if (progress.phase === "error") {
      toast.error(t`同步失败`, {
        id: SYNC_TOAST_ID,
        description: progress.errorMessage ?? undefined,
        duration: 8000,
      });
      // 用微任务延后，使 setState 发生在 effect 函数体之外。
      queueMicrotask(() => void refreshInEffect());
    }
  }, [
    progress.phase,
    progress.updatedAt,
    progress.bytesDone,
    progress.bytesTotal,
    progress.collectionId,
    progress.errorMessage,
    progress.imported,
    progress.total,
    t,
  ]);
  const { pending, installed, installedStats } = (() => {
    const byTier = (a: PoetryCollectionStatus, b: PoetryCollectionStatus) =>
      TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
      a.name.localeCompare(b.name);
    const pendingList = collections
      .filter((collection) => !collection.installed)
      .sort(byTier);
    const installedList = collections
      .filter((collection) => collection.installed)
      .sort(byTier);
    const stats = installedList.reduce(
      (acc, collection) => ({
        poems: acc.poems + collection.poemCount,
        bytes: acc.bytes + Math.max(0, collection.bytesUsed),
      }),
      {
        poems: 0,
        bytes: 0,
      },
    );
    return {
      pending: pendingList,
      installed: installedList,
      installedStats: stats,
    };
  })();
  useEffect(() => {
    if (pending.length === 0) return;
    // 用微任务延后，使 setState 发生在 effect 函数体之外；在此重新计算
    // 默认值，这样依赖数组只需稳定的 `pending` 状态。
    const defaults = new Set(
      pending
        .filter((collection) => collection.tier !== "optIn")
        .map((collection) => collection.id),
    );
    queueMicrotask(() =>
      setSelected((prev) => (prev.size === 0 ? defaults : prev)),
    );
  }, [pending]);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const syncBusy = progress.active;
  const startSync = async () => {
    const ids = [...selected].filter((id) =>
      pending.some((collection) => collection.id === id),
    );
    if (ids.length === 0) {
      toast.info(t`请先选择合集`);
      return;
    }
    setStarting(true);
    try {
      await poetrySyncStart(ids);
    } catch (error) {
      toast.error(t`操作失败`, {
        description: String(error),
      });
    } finally {
      setStarting(false);
    }
  };
  const importLocal = async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "tar.gz",
          extensions: ["tar.gz", "tgz"],
        },
      ],
    });
    if (typeof picked !== "string") return;
    const ids = selected.size > 0 ? [...selected] : [];
    if (ids.length === 0) {
      toast.info(t`请先选择合集`);
      return;
    }
    try {
      await poetrySyncImportLocal(picked, ids);
    } catch (error) {
      toast.error(t`操作失败`, {
        description: String(error),
      });
    }
  };
  const handleDeleteConfirmed = async () => {
    const status = pendingDelete;
    if (!status) return;
    setPendingDelete(null);
    try {
      await poetryCollectionDelete(status.id);
      const statusName2 = status.name;
      toast.success(t`已删除 ${statusName2}`);
      void refresh();
    } catch (error) {
      toast.error(t`操作失败`, {
        description: String(error),
      });
    }
  };
  const toggleBodyIndex = async (enable: boolean) => {
    try {
      if (enable) {
        toast.loading(t`正在建立正文索引…`, {
          id: INDEX_TOAST_ID,
          duration: Number.POSITIVE_INFINITY,
        });
      }
      await poetryContentIndexBuild(enable);
      setBodyIndex(await poetryContentIndexStatus());
      toast.dismiss(INDEX_TOAST_ID);
      toast.success(t`正文索引已更新`);
    } catch (error) {
      toast.error(t`操作失败`, {
        id: INDEX_TOAST_ID,
        description: String(error),
      });
    }
  };
  const installAnnotations = async () => {
    // 进度与失败通过同步的终态事件呈现。
    await poetryAnnotationsInstall().catch(() => {});
  };
  const deleteAnnotations = async () => {
    try {
      await poetryAnnotationsDelete();
      setAnnotationsCount(0);
      toast.success(t`已删除`);
    } catch (error) {
      toast.error(t`操作失败`, {
        description: String(error),
      });
    }
  };
  const progressLabelFor = (id: string) => {
    if (!syncBusy || progress.collectionId !== id) return undefined;
    if (progress.phase === "importing") {
      return `${t`已导入`} ${progress.imported.toLocaleString()}`;
    }
    return undefined;
  };
  const installedLength = installed.length;
  const toLocaleStringValue = installedStats.poems.toLocaleString();
  const formatBytesValue = formatBytes(installedStats.bytes);
  const toLocaleStringValue2 = bodyIndex?.indexedPoems.toLocaleString();
  const toLocaleStringValue3 = annotationsCount?.toLocaleString();
  const pendingDeleteName = pendingDelete?.name;
  const toLocaleStringValue4 = pendingDelete?.poemCount.toLocaleString();
  return (
    <main className="bg-background text-foreground flex h-full flex-col">
      <ToolPageHeader
        title={<Trans>古诗词 · 数据管理</Trans>}
        trailing={
          <Button variant="ghost" size="xs" asChild>
            <Link
              to="/library"
              search={{
                q: undefined,
                poem: undefined,
              }}
            >
              <BookMarked data-icon="inline-start" />
              <Trans>返回古诗词</Trans>
            </Link>
          </Button>
        }
      />

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-5 overflow-y-auto px-4 py-3 pb-10">
        {/* 待安装：主要的待处理集合。 */}
        <section className="space-y-2">
          <header className="flex min-h-7 items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              <Trans>获取语料</Trans>
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                {t`来自 chinese-poetry（MIT），下载后离线可用`}
              </span>
            </h2>
            {syncBusy && progress.collectionId !== "body-index" ? (
              <Button
                variant="outline"
                size="xs"
                onClick={() => void poetrySyncCancel()}
              >
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                />
                <Trans>取消同步</Trans>
              </Button>
            ) : null}
          </header>

          {pending.length > 0 ? (
            <div className="border-border rounded-lg border py-1">
              {pending.map((status) => (
                <CollectionRow
                  key={status.id}
                  status={status}
                  busy={syncBusy}
                  selected={selected.has(status.id)}
                  onToggle={() => toggle(status.id)}
                  progressLabel={progressLabelFor(status.id)}
                  onDelete={setPendingDelete}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground px-1 text-xs">
              <Trans>全部合集均已安装。</Trans>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={syncBusy || starting || pending.length === 0}
              onClick={() => void startSync()}
            >
              <ArrowDownToLine data-icon="inline-start" />
              <Trans>下载所选</Trans>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={syncBusy}
              onClick={() => void importLocal()}
            >
              <FolderInput data-icon="inline-start" />
              <Trans>从本地 tar.gz 导入…</Trans>
            </Button>
          </div>
        </section>

        {/* 已安装：默认折叠，在标题栏汇总。 */}
        {installed.length > 0 ? (
          <section className="space-y-1">
            <button
              type="button"
              onClick={() => setInstalledOpen((value) => !value)}
              aria-expanded={installedOpen}
              className="hover:bg-accent/50 flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-sm font-semibold"
            >
              <ChevronRight
                className={`text-muted-foreground size-4 transition-transform ${installedOpen ? "rotate-90" : ""}`}
                aria-hidden
              />
              <Trans>已安装</Trans>
              <span className="text-muted-foreground font-normal">
                {t`${installedLength} 个合集 · ${toLocaleStringValue} 篇 · ${formatBytesValue}`}
              </span>
            </button>
            {installedOpen ? (
              <div className="border-border rounded-lg border py-1">
                {installed.map((status) => (
                  <CollectionRow
                    key={status.id}
                    status={status}
                    busy={syncBusy}
                    progressLabel={progressLabelFor(status.id)}
                    onDelete={setPendingDelete}
                  />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {/* 偏好：两行精简设置。 */}
        <section className="border-border divide-y rounded-lg border">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <ScrollText
                  className="text-muted-foreground size-3.5"
                  aria-hidden
                />
                <Trans>正文全文索引</Trans>
              </p>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {bodyIndex?.enabled
                  ? t`已索引 ${toLocaleStringValue2} 篇，搜索亚毫秒返回`
                  : t`关闭时正文搜索走 LIKE 兜底，较慢`}
              </p>
            </div>
            <label className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs">
              <Checkbox
                checked={bodyIndex?.enabled ?? false}
                onCheckedChange={(checked) =>
                  void toggleBodyIndex(checked === true)
                }
                aria-label={t`正文全文索引`}
              />
              {t`开启`}
            </label>
          </div>

          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                <Trans>注释包（译文 / 赏析）</Trans>
              </p>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {annotationsCount
                  ? t`已安装 ${toLocaleStringValue3} 条，约 14MB`
                  : t`未安装；仅点击时下载，可随时删除`}
              </p>
            </div>
            {annotationsCount ? (
              <Button
                variant="outline"
                size="xs"
                onClick={() => void deleteAnnotations()}
              >
                <Trash2 data-icon="inline-start" />
                <Trans>删除</Trans>
              </Button>
            ) : (
              <Button
                size="xs"
                disabled={syncBusy}
                onClick={() => void installAnnotations()}
              >
                <ArrowDownToLine data-icon="inline-start" />
                <Trans>安装</Trans>
              </Button>
            )}
          </div>
        </section>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t`卸载合集`}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? t`将删除「${pendingDeleteName}」的全部本地数据（${toLocaleStringValue4} 篇）。此操作不可撤销。`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t`取消`}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDeleteConfirmed()}>
              {t`卸载`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
