import { useEffect, useEffectEvent, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowLeft, Download, LoaderCircle, Trash2 } from "lucide-react";
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
import { formatBytes } from "~/lib/format";
import {
  poetryCollectionDelete,
  poetryCollections,
  poetrySyncCancel,
  poetrySyncStart,
} from "~/lib/ipc";
import type { PoetryCollectionStatus } from "~/types";
import { usePoetrySyncProgress } from "./hooks/use-poetry-sync";
import { usePoetryStore } from "./store/poetry-store";

export default function LibraryMobileManagePage() {
  const { t } = useLingui();
  const collections = usePoetryStore((state) => state.collections);
  const setCollections = usePoetryStore((state) => state.setCollections);
  const progress = usePoetrySyncProgress();
  const [selected, setSelected] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] =
    useState<PoetryCollectionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const next = await poetryCollections();
      setCollections(next);
      setSelected((current) => {
        const valid = current.filter((id) =>
          next.some((item) => item.id === id && !item.installed),
        );
        return valid;
      });
    } catch (error) {
      toast.error(t`读取失败`, { description: String(error) });
    } finally {
      setLoading(false);
    }
  };

  const refreshInEffect = useEffectEvent(refresh);

  useEffect(() => {
    queueMicrotask(() => void refreshInEffect());
  }, []);

  useEffect(() => {
    if (progress.phase === "done") {
      toast.success(t`下载完成`);
      queueMicrotask(() => void refreshInEffect());
    } else if (progress.phase === "error") {
      toast.error(t`下载失败`, {
        description: progress.errorMessage ?? undefined,
      });
      queueMicrotask(() => void refreshInEffect());
    }
  }, [progress.phase, progress.errorMessage, t]);

  const pending = collections.filter((item) => !item.installed);
  const installed = collections.filter((item) => item.installed);
  const selectedPending = selected.filter((id) =>
    pending.some((item) => item.id === id),
  );
  const busy = progress.active;
  const progressLabel =
    progress.phase === "verifying"
      ? t`正在校验`
      : progress.phase === "importing"
        ? t`正在导入`
        : t`正在下载`;

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );

  const startDownload = async () => {
    if (selectedPending.length === 0) {
      toast.info(t`请先选择合集`);
      return;
    }
    try {
      await poetrySyncStart(selectedPending);
    } catch (error) {
      toast.error(t`下载失败`, { description: String(error) });
    }
  };

  const cancelDownload = async () => {
    try {
      await poetrySyncCancel();
    } catch (error) {
      toast.error(t`操作失败`, { description: String(error) });
    }
  };

  const confirmDelete = async () => {
    const item = pendingDelete;
    if (!item) return;
    setPendingDelete(null);
    try {
      await poetryCollectionDelete(item.id);
      const itemName = item.name;
      toast.success(t`已删除 ${itemName}`);
      await refresh();
    } catch (error) {
      toast.error(t`操作失败`, { description: String(error) });
    }
  };

  return (
    <main className="bg-background text-foreground flex h-full flex-col">
      <ToolPageHeader
        title={<Trans>获取诗词数据</Trans>}
        trailing={
          <Button variant="ghost" size="icon-sm" asChild>
            <Link
              to="/library"
              aria-label={t`返回古诗词`}
              title={t`返回古诗词`}
            >
              <ArrowLeft />
            </Link>
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <p className="text-muted-foreground mb-3 text-xs leading-relaxed">
          <Trans>
            数据直接下载到本设备，安装后可离线阅读。下载期间请保持应用开启。
          </Trans>
        </p>
        {loading ? (
          <div className="text-muted-foreground flex justify-center py-10">
            <LoaderCircle className="size-5 animate-spin" aria-hidden />
          </div>
        ) : (
          <div className="space-y-5">
            {pending.length > 0 ? (
              <section className="space-y-2">
                <h2 className="text-sm font-medium">
                  <Trans>可下载合集</Trans>
                </h2>
                <div className="space-y-1">
                  {pending.map((item) => (
                    <label
                      key={item.id}
                      className="border-border bg-card flex min-h-12 items-center gap-3 rounded-md border px-3 py-2"
                    >
                      <Checkbox
                        checked={selected.includes(item.id)}
                        disabled={busy}
                        onCheckedChange={() => toggle(item.id)}
                        aria-label={item.name}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {item.name}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {item.dynasty} ·{" "}
                          {item.tier === "recommended" ? t`推荐` : t`可选`}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <Button
                  className="w-full"
                  disabled={busy || selectedPending.length === 0}
                  onClick={() => void startDownload()}
                >
                  {busy ? (
                    <LoaderCircle
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <Download data-icon="inline-start" />
                  )}
                  {busy ? progressLabel : <Trans>下载所选合集</Trans>}
                </Button>
                {busy ? (
                  <div className="text-muted-foreground text-center text-xs">
                    {progress.bytesTotal
                      ? `${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}`
                      : formatBytes(progress.bytesDone)}
                    <Button
                      variant="link"
                      size="sm"
                      className="ml-1 h-auto px-1"
                      onClick={() => void cancelDownload()}
                    >
                      <Trans>取消</Trans>
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}
            <section className="space-y-2">
              <h2 className="text-sm font-medium">
                <Trans>已安装合集</Trans>
              </h2>
              {installed.length > 0 ? (
                installed.map((item) => {
                  const itemName = item.name;
                  return (
                    <div
                      key={item.id}
                      className="border-border bg-card flex min-h-12 items-center gap-3 rounded-md border px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {itemName}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {item.poemCount.toLocaleString()} ·{" "}
                          {formatBytes(Math.max(0, item.bytesUsed))}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        aria-label={t`删除 ${itemName}`}
                        title={t`删除 ${itemName}`}
                        onClick={() => setPendingDelete(item)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  );
                })
              ) : (
                <p className="text-muted-foreground text-xs">
                  <Trans>尚未安装合集</Trans>
                </p>
              )}
            </section>
          </div>
        )}
      </div>
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t`删除诗词合集？`}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>删除后需要重新下载，不会影响已保存的 AI 译文。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t`取消`}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>
              {t`确认删除`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
