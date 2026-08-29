import { useCallback, useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Database, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { BtCacheItem } from "~/types";
import * as ipc from "~/lib/ipc";
import { formatBytes } from "~/lib/format";
import { Button } from "~/components/ui/button";

export interface CacheManagerProps {
  /** Notifies the page that tasks were removed. */
  onChanged: () => Promise<void> | void;
}

/**
 * Preview cache pool: usage against the quota plus the actual entries, so a
 * single cached torrent can be dropped without clearing everything. Ordered
 * most recently used first (same order eviction walks backwards).
 */
export default function CacheManager({ onChanged }: CacheManagerProps) {
  const { t } = useLingui();
  const [quotaGb, setQuotaGb] = useState<number | null>(null);
  const [usedBytes, setUsedBytes] = useState(0);
  const [items, setItems] = useState<BtCacheItem[]>([]);

  const reload = useCallback(async () => {
    try {
      const stats = await ipc.btCacheStats();
      setUsedBytes(stats.usedBytes);
      setQuotaGb(Math.max(1, Math.round(stats.quotaBytes / 1024 ** 3)));
      setItems(await ipc.btCacheItems());
    } catch {
      // Engine not started yet: leave the previous snapshot in place.
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = useCallback(
    async (item: BtCacheItem) => {
      try {
        await ipc.btRemoveCache(item.infoHash);
        await reload();
        await onChanged();
      } catch (error) {
        toast.error(String(error));
      }
    },
    [onChanged, reload],
  );

  if (quotaGb == null) return null;

  const percent = Math.min(
    100,
    Math.round((usedBytes / (quotaGb * 1024 ** 3)) * 100),
  );

  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-border px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Database className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium">
          <Trans>在线预览缓存</Trans>
        </span>
        <span className="tabular-nums text-muted-foreground">
          {formatBytes(usedBytes)} · {percent}% · {t`${items.length} 个任务`}
        </span>
        <span className="flex-1" />
        <label className="flex items-center gap-1 text-muted-foreground">
          <Trans>配额 GB</Trans>
          <input
            type="number"
            min={1}
            max={1024}
            value={quotaGb}
            onChange={(e) => {
              const gb = Number(e.target.value);
              if (gb >= 1) void ipc.btSetCacheQuota(gb * 1024 ** 3).then(reload);
            }}
            className="w-16 rounded-md border border-border bg-background px-1.5 py-0.5 tabular-nums outline-none focus-visible:border-ring"
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
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      {items.length > 0 ? (
        <div className="flex max-h-32 flex-col overflow-y-auto">
          {items.map((item) => (
            <div
              key={item.infoHash}
              className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-sidebar-accent"
              title={new Date(item.lastAccess).toLocaleString()}
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.streaming ? (
                <span className="shrink-0 rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">
                  <Trans>使用中</Trans>
                </span>
              ) : null}
              <span className="shrink-0 tabular-nums text-muted-foreground">
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
