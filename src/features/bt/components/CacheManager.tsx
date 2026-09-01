import { useEffect, useEffectEvent, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { Database, HardDriveDownload, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { BtCacheItem, BtFileMeta } from "~/types";
import * as ipc from "~/lib/ipc";
import { formatBytes } from "~/lib/format";
import { BT_TASK_EVENT } from "~/lib/events";
import { isPreviewable, previewKind } from "~/lib/preview-kind";
import { Button } from "~/components/ui/button";
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
import { previewSearch, saveFileToLocal } from "../file-actions";
export interface CacheManagerProps {
  /** 通知页面有任务被移除。 */
  onChanged: () => Promise<void> | void;
}

/** 占用与条目都要跟着下载走，但每次都会全量扫一遍缓存目录，
 * 因此比页面轮询慢一档。 */
const RELOAD_INTERVAL = 5000;
/** 配额输入停手后才写库（写库会顺带触发扫盘）。 */
const QUOTA_DEBOUNCE = 400;

/**
 * 在线预览缓存池：展示配额占用与实际条目，从而能单独丢弃
 * 某个已缓存的种子而不清空全部。按最近使用排序（淘汰也按同一顺序反向走）。
 */
export default function CacheManager({ onChanged }: CacheManagerProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [quotaGb, setQuotaGb] = useState<number | null>(null);
  // 用户正在编辑的配额；非空时后端值不覆盖输入框。
  const [quotaDraft, setQuotaDraft] = useState<string | null>(null);
  const [usedBytes, setUsedBytes] = useState(0);
  const [items, setItems] = useState<BtCacheItem[]>([]);
  // 待确认的转存：预览缓存转存成功后条目会被清掉，所以先问一次。
  const [pendingSave, setPendingSave] = useState<{
    infoHash: string;
    label: string;
    index: number;
  } | null>(null);
  const quotaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reload = async () => {
    try {
      const stats = await ipc.btCacheStats();
      setUsedBytes(stats.usedBytes);
      setQuotaGb(Math.max(1, Math.round(stats.quotaBytes / 1024 ** 3)));
      setItems(await ipc.btCacheItems());
    } catch {
      // 引擎尚未启动：保留上次的快照。
    }
  };
  // 调用最新的 reload，且不在其身份变化时重跑。微任务把调用移出 effect
  // 函数体，这样 effect 期间不会同步 setState（其更新原本都在 await 之后）。
  const reloadInEffect = useEffectEvent(reload);
  useEffect(() => {
    queueMicrotask(() => void reloadInEffect());
    // 下载过程中占用会涨；比页面轮询慢一档，因为每次都要扫盘。
    const timer = setInterval(() => void reloadInEffect(), RELOAD_INTERVAL);
    return () => clearInterval(timer);
  }, []);
  // 转存 / 删除 / 取消都会改动缓存池，事件到达时立刻刷新，不等下一次轮询。
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | null = null;
    void listen<{
      infoHash: string;
      kind: string;
    }>(BT_TASK_EVENT, () => void reloadInEffect()).then((unlisten) => {
      if (cancelled) unlisten();
      else dispose = unlisten;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);
  useEffect(() => () => {
    if (quotaTimer.current) clearTimeout(quotaTimer.current);
  });
  const commitQuota = async (raw: string) => {
    if (quotaTimer.current) {
      clearTimeout(quotaTimer.current);
      quotaTimer.current = null;
    }
    const gb = Number(raw);
    if (!Number.isFinite(gb) || gb < 1) {
      setQuotaDraft(null);
      return;
    }
    setQuotaDraft(null);
    try {
      await ipc.btSetCacheQuota(Math.min(1024, Math.round(gb)) * 1024 ** 3);
      await reload();
    } catch (error) {
      toast.error(String(error));
    }
  };
  const commitQuotaLater = (raw: string) => {
    if (quotaTimer.current) clearTimeout(quotaTimer.current);
    quotaTimer.current = setTimeout(
      () => void commitQuota(raw),
      QUOTA_DEBOUNCE,
    );
  };
  const remove = async (item: BtCacheItem) => {
    try {
      await ipc.btRemoveCache(item.infoHash);
      await reload();
      await onChanged();
    } catch (error) {
      toast.error(String(error));
    }
  };
  /** 打开缓存文件：进预览页，未下完也能边下边看。 */
  const openFile = async (item: BtCacheItem, file: BtFileMeta) => {
    try {
      await navigate({
        to: "/preview",
        search: previewSearch(item.infoHash, file),
      });
    } catch (error) {
      toast.error(t`在线预览失败`, {
        description: String(error),
      });
    }
  };
  const confirmSave = async () => {
    const target = pendingSave;
    setPendingSave(null);
    if (!target) return;
    try {
      if (await saveFileToLocal(target.infoHash, target.index)) {
        await reload();
        await onChanged();
      }
    } catch (error) {
      toast.error(t`转存失败`, {
        description: String(error),
      });
    }
  };
  if (quotaGb == null) return null;
  const percent = Math.min(
    100,
    Math.round((usedBytes / (quotaGb * 1024 ** 3)) * 100),
  );
  const itemsLength = items.length;
  const pendingSaveLabel = pendingSave?.label;
  return (
    <div className="border-border flex shrink-0 flex-col gap-2 rounded-lg border px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Database className="text-muted-foreground size-3.5 shrink-0" />
        <span className="font-medium">
          <Trans>在线预览缓存</Trans>
        </span>
        <span className="text-muted-foreground tabular-nums">
          {formatBytes(usedBytes)} · {percent}% · {t`${itemsLength} 个任务`}
        </span>
        <span className="flex-1" />
        <label className="text-muted-foreground flex items-center gap-1">
          <Trans>配额 GB</Trans>
          <input
            type="number"
            min={1}
            max={1024}
            value={quotaDraft ?? quotaGb}
            onChange={(e) => {
              setQuotaDraft(e.target.value);
              commitQuotaLater(e.target.value);
            }}
            onBlur={(e) => void commitQuota(e.target.value)}
            className="border-border bg-background focus-visible:border-ring w-16 rounded-md border px-1.5 py-0.5 tabular-nums outline-none"
          />
        </label>
        <Button
          variant="ghost"
          size="xs"
          disabled={items.length === 0}
          onClick={async () => {
            try {
              const removed = await ipc.btClearCache();
              toast.success(t`已清除 ${removed} 个缓存任务`);
              await reload();
              await onChanged();
            } catch (error) {
              toast.error(String(error));
            }
          }}
        >
          <Trans>清空</Trans>
        </Button>
      </div>
      <div className="bg-muted h-1 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full transition-[width]"
          style={{
            width: `${percent}%`,
          }}
        />
      </div>
      {items.length > 0 ? (
        <div className="flex max-h-32 flex-col overflow-y-auto">
          {items.map((item) => {
            // 引擎还没恢复句柄时 files 为空，此时只保留删除入口。
            const openable = item.files.find((file) =>
              isPreviewable(previewKind(file.path)),
            );
            const savable = item.files[0];
            return (
              <div
                key={item.infoHash}
                className="hover:bg-sidebar-accent flex items-center gap-2 rounded-md px-1 py-1"
                title={new Date(item.lastAccess).toLocaleString()}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.streaming ? (
                  <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1 py-px text-[10px]">
                    <Trans>使用中</Trans>
                  </span>
                ) : null}
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {item.totalBytes != null
                    ? `${formatBytes(item.sizeBytes)} / ${formatBytes(item.totalBytes)}`
                    : formatBytes(item.sizeBytes)}
                </span>
                {openable ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={t`打开`}
                    aria-label={t`打开`}
                    onClick={() => void openFile(item, openable)}
                  >
                    <Play />
                  </Button>
                ) : null}
                {savable ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={t`下载`}
                    aria-label={t`下载`}
                    disabled={item.pinned}
                    onClick={() =>
                      setPendingSave({
                        infoHash: item.infoHash,
                        label: item.label,
                        index: savable.index,
                      })
                    }
                  >
                    <HardDriveDownload />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title={t`删除`}
                  aria-label={t`删除`}
                  disabled={item.streaming || item.pinned}
                  onClick={() => void remove(item)}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}

      <AlertDialog
        open={pendingSave !== null}
        onOpenChange={(open) => !open && setPendingSave(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingSave ? t`下载 ${pendingSaveLabel}` : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>转存完成后会从缓存中移除。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t`取消`}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmSave()}>
              {t`下载`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
