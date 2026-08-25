import { useEffect, useMemo, useState } from "react";
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

/** One compact row per collection: checkbox (pending) / stats / delete. */
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

  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50">
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
          <span className="shrink-0 text-xs text-muted-foreground">
            {busy && progressLabel ? progressLabel : meta}
          </span>
        </span>
      </span>
      {status.installed ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t`卸载 ${status.name}`}
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
  const [bodyIndex, setBodyIndex] =
    useState<PoetryContentIndexStatus | null>(null);
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
      toast.error(t`读取失败`, { description: String(error) });
    }
  };

  // Initial load; terminal phases refresh the cards and surface toasts.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live progress in a fixed-id toast, mirroring the updater flow: loading
  // updates in place, then a terminal success/error replaces it.
  useEffect(() => {
    // Body-index events have their own toast lifecycle below.
    if (progress.collectionId === "body-index") return;
    if (progress.phase === "downloading") {
      toast.loading(t`正在下载语料`, {
        id: SYNC_TOAST_ID,
        description: `${formatBytes(progress.bytesDone)}${
          progress.bytesTotal ? ` / ${formatBytes(progress.bytesTotal)}` : ""
        }`,
        duration: Number.POSITIVE_INFINITY,
      });
    } else if (progress.phase === "importing" || progress.phase === "indexing") {
      toast.loading(t`正在导入语料`, {
        id: SYNC_TOAST_ID,
        description: `${t`已导入`} ${progress.imported.toLocaleString()}${
          progress.total ? ` / ${progress.total.toLocaleString()}` : ""
        }`,
        duration: Number.POSITIVE_INFINITY,
      });
    } else if (progress.phase === "done") {
      toast.success(t`同步完成`, { id: SYNC_TOAST_ID, duration: 4000 });
      void refresh();
    } else if (progress.phase === "error") {
      toast.error(t`同步失败`, {
        id: SYNC_TOAST_ID,
        description: progress.errorMessage ?? undefined,
        duration: 8000,
      });
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.phase, progress.updatedAt]);

  const { pending, installed, installedStats } = useMemo(() => {
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
      { poems: 0, bytes: 0 },
    );
    return { pending: pendingList, installed: installedList, installedStats: stats };
  }, [collections]);

  const defaultSelection = useMemo(
    () =>
      new Set(
        pending
          .filter((collection) => collection.tier !== "optIn")
          .map((collection) => collection.id),
      ),
    [pending],
  );

  useEffect(() => {
    if (pending.length === 0) return;
    setSelected((prev) => (prev.size === 0 ? defaultSelection : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSelection]);

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
      toast.error(t`操作失败`, { description: String(error) });
    } finally {
      setStarting(false);
    }
  };

  const importLocal = async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "tar.gz", extensions: ["tar.gz", "tgz"] }],
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
      toast.error(t`操作失败`, { description: String(error) });
    }
  };

  const handleDeleteConfirmed = async () => {
    const status = pendingDelete;
    if (!status) return;
    setPendingDelete(null);
    try {
      await poetryCollectionDelete(status.id);
      toast.success(t`已删除 ${status.name}`);
      void refresh();
    } catch (error) {
      toast.error(t`操作失败`, { description: String(error) });
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
    // Progress and failure surface through the sync terminal event.
    await poetryAnnotationsInstall().catch(() => {});
  };

  const deleteAnnotations = async () => {
    try {
      await poetryAnnotationsDelete();
      setAnnotationsCount(0);
      toast.success(t`已删除`);
    } catch (error) {
      toast.error(t`操作失败`, { description: String(error) });
    }
  };

  const progressLabelFor = (id: string) => {
    if (!syncBusy || progress.collectionId !== id) return undefined;
    if (progress.phase === "importing") {
      return `${t`已导入`} ${progress.imported.toLocaleString()}`;
    }
    return undefined;
  };

  return (
    <main className="flex h-full flex-col bg-background text-foreground">
      <ToolPageHeader
        title={<Trans>古诗词 · 数据管理</Trans>}
        trailing={
          <Button variant="ghost" size="xs" asChild>
            <Link to="/library" search={{ q: undefined, poem: undefined }}>
              <BookMarked data-icon="inline-start" />
              <Trans>返回古诗词</Trans>
            </Link>
          </Button>
        }
      />

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-5 overflow-y-auto px-4 py-3 pb-10">
        {/* Pending installs: the primary working set. */}
        <section className="space-y-2">
          <header className="flex min-h-7 items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              <Trans>获取语料</Trans>
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {t`来自 chinese-poetry（MIT），下载后离线可用`}
              </span>
            </h2>
            {syncBusy && progress.collectionId !== "body-index" ? (
              <Button
                variant="outline"
                size="xs"
                onClick={() => void poetrySyncCancel()}
              >
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
                <Trans>取消同步</Trans>
              </Button>
            ) : null}
          </header>

          {pending.length > 0 ? (
            <div className="rounded-lg border border-border py-1">
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
            <p className="px-1 text-xs text-muted-foreground">
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

        {/* Installed: collapsed by default, summarized in the header. */}
        {installed.length > 0 ? (
          <section className="space-y-1">
            <button
              type="button"
              onClick={() => setInstalledOpen((value) => !value)}
              aria-expanded={installedOpen}
              className="flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-sm font-semibold hover:bg-accent/50"
            >
              <ChevronRight
                className={`size-4 text-muted-foreground transition-transform ${
                  installedOpen ? "rotate-90" : ""
                }`}
                aria-hidden
              />
              <Trans>已安装</Trans>
              <span className="font-normal text-muted-foreground">
                {t`${installed.length} 个合集 · ${installedStats.poems.toLocaleString()} 篇 · ${formatBytes(installedStats.bytes)}`}
              </span>
            </button>
            {installedOpen ? (
              <div className="rounded-lg border border-border py-1">
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

        {/* Preferences: two slim rows. */}
        <section className="divide-y rounded-lg border border-border">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <ScrollText className="size-3.5 text-muted-foreground" aria-hidden />
                <Trans>正文全文索引</Trans>
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {bodyIndex?.enabled
                  ? t`已索引 ${bodyIndex.indexedPoems.toLocaleString()} 篇，搜索亚毫秒返回`
                  : t`关闭时正文搜索走 LIKE 兜底，较慢`}
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
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
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {annotationsCount
                  ? t`已安装 ${annotationsCount.toLocaleString()} 条，约 14MB`
                  : t`未安装；仅点击时下载，可随时删除`}
              </p>
            </div>
            {annotationsCount ? (
              <Button variant="outline" size="xs" onClick={() => void deleteAnnotations()}>
                <Trash2 data-icon="inline-start" />
                <Trans>删除</Trans>
              </Button>
            ) : (
              <Button size="xs" disabled={syncBusy} onClick={() => void installAnnotations()}>
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
                ? t`将删除「${pendingDelete.name}」的全部本地数据（${pendingDelete.poemCount.toLocaleString()} 篇）。此操作不可撤销。`
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
