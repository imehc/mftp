import { useEffect, useEffectEvent, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Database, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { BtCacheItem } from "~/types";
import * as ipc from "~/lib/ipc";
import { formatBytes } from "~/lib/format";
import { Button } from "~/components/ui/button";
export interface CacheManagerProps {
  /** 通知页面有任务被移除。 */
  onChanged: () => Promise<void> | void;
}

/**
 * 在线预览缓存池：展示配额占用与实际条目，从而能单独丢弃
 * 某个已缓存的种子而不清空全部。按最近使用排序（淘汰也按同一顺序反向走）。
 */
export default function CacheManager({ onChanged }: CacheManagerProps) {
  const { t } = useLingui();
  const [quotaGb, setQuotaGb] = useState<number | null>(null);
  const [usedBytes, setUsedBytes] = useState(0);
  const [items, setItems] = useState<BtCacheItem[]>([]);
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
  // 仅挂载时拉取：调用最新的 reload，且不在其身份变化时重跑。
  // 微任务把调用移出 effect 函数体，这样 effect 期间不会同步 setState
  //（其更新原本都在 await 之后）。
  const reloadOnMount = useEffectEvent(reload);
  useEffect(() => {
    queueMicrotask(() => void reloadOnMount());
  }, []);
  const remove = async (item: BtCacheItem) => {
    try {
      await ipc.btRemoveCache(item.infoHash);
      await reload();
      await onChanged();
    } catch (error) {
      toast.error(String(error));
    }
  };
  if (quotaGb == null) return null;
  const percent = Math.min(
    100,
    Math.round((usedBytes / (quotaGb * 1024 ** 3)) * 100),
  );
  const itemsLength = items.length;
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
            value={quotaGb}
            onChange={(e) => {
              const gb = Number(e.target.value);
              if (gb >= 1)
                void ipc.btSetCacheQuota(gb * 1024 ** 3).then(reload);
            }}
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
          {items.map((item) => (
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
          ))}
        </div>
      ) : null}
    </div>
  );
}
