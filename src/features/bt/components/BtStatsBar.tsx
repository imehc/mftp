import { useCallback, useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { BtTaskStats } from "~/types";
import * as ipc from "~/lib/ipc";
import { formatBytes } from "~/lib/format";

export interface BtStatsBarProps {
  infoHash: string;
  /** Opens the peer detail overlay owned by the parent. */
  onShowPeers: () => void;
}

const POLL_INTERVAL_MS = 1500;

function stateLabel(stats: BtTaskStats) {
  if (stats.state === "Initializing") return <Trans>获取资源信息…</Trans>;
  // The engine keeps a completed torrent live, but calling that "seeding"
  // while nothing is being uploaded only reads as stuck: what matters on the
  // preview page is that the file is fully cached.
  if (stats.state === "Seeding")
    return stats.upBps > 0 ? <Trans>做种中</Trans> : <Trans>已完成</Trans>;
  if (stats.state === "Paused") return <Trans>已暂停</Trans>;
  if (stats.state === "Error") return <Trans>错误</Trans>;
  return <Trans>下载中</Trans>;
}

/**
 * Live transfer stats under the player. Polled rather than event-driven: the
 * shared progress event carries no speed or peer counts, and this bar only
 * matters while the page is open.
 */
export default function BtStatsBar({ infoHash, onShowPeers }: BtStatsBarProps) {
  const { t } = useLingui();
  const [stats, setStats] = useState<BtTaskStats | null>(null);

  const poll = useCallback(async () => {
    try {
      setStats(await ipc.btTaskStats(infoHash));
    } catch {
      // Engine restarts or task removal: keep the last snapshot instead of
      // flashing an error under the player.
    }
  }, [infoHash]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  if (!stats) return null;

  const percent =
    stats.total > 0
      ? Math.min(100, Math.round((stats.progress / stats.total) * 100))
      : 0;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{stateLabel(stats)}</span>
        <span className="tabular-nums text-muted-foreground">
          {formatBytes(stats.progress)} / {formatBytes(stats.total)} · {percent}%
        </span>
        {/* Idle rates carry no information; a completed file would otherwise
            sit behind two permanent 0 B/s readings. */}
        {stats.downBps > 0 ? (
          <span className="flex items-center gap-1 tabular-nums" title={t`下载`}>
            <ArrowDown className="size-3 text-muted-foreground" />
            {formatBytes(stats.downBps)}/s
          </span>
        ) : null}
        {stats.upBps > 0 ? (
          <span className="flex items-center gap-1 tabular-nums" title={t`上传`}>
            <ArrowUp className="size-3 text-muted-foreground" />
            {formatBytes(stats.upBps)}/s
          </span>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          className="tabular-nums text-muted-foreground hover:text-foreground hover:underline"
          title={t`查看节点明细`}
          onClick={onShowPeers}
        >
          {t`节点`} {stats.peersLive}
          {stats.peersQueued > 0 ? ` (+${stats.peersQueued})` : ""}
        </button>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
