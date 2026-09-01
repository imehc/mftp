import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { BtTaskStats } from "~/types";
import * as ipc from "~/lib/ipc";
import { formatBytes } from "~/lib/format";
export interface BtStatsBarProps {
  infoHash: string;
  /** 被预览的文件序号：字节数只统计这个文件，种子里的其他文件不算。 */
  fileIndex: number;
  /** 打开由父组件持有的节点明细浮层。 */
  onShowPeers: () => void;
}
const POLL_INTERVAL_MS = 1500;
function stateLabel(stats: BtTaskStats) {
  if (stats.state === "Initializing") return <Trans>获取资源信息…</Trans>;
  // 引擎会让已完成的种子保持在线，但“什么都没上传”时
  // 说它“做种”只会像卡住了：在预览页重要的是文件已完整缓存。
  if (stats.state === "Seeding")
    return stats.upBps > 0 ? <Trans>做种中</Trans> : <Trans>已完成</Trans>;
  if (stats.state === "Paused") return <Trans>已暂停</Trans>;
  if (stats.state === "Error") return <Trans>错误</Trans>;
  return <Trans>下载中</Trans>;
}

/**
 * 播放器下方的实时传输统计。采用轮询而非事件驱动：共享的
 * 进度事件不含速度或节点数，而本栏只在页面打开期间才有意义。
 */
export default function BtStatsBar({
  infoHash,
  fileIndex,
  onShowPeers,
}: BtStatsBarProps) {
  const { t } = useLingui();
  const [stats, setStats] = useState<BtTaskStats | null>(null);
  useEffect(() => {
    const poll = async () => {
      try {
        setStats(await ipc.btTaskStats(infoHash, fileIndex));
      } catch {
        // 引擎重启或任务被移除：保留最后一次快照，
        // 而不是在播放器下方闪出错误。
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fileIndex, infoHash]);
  if (!stats) return null;
  const percent =
    stats.total > 0
      ? Math.min(100, Math.round((stats.progress / stats.total) * 100))
      : 0;
  return (
    <div className="border-border flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{stateLabel(stats)}</span>
        <span className="text-muted-foreground tabular-nums">
          {formatBytes(stats.progress)} / {formatBytes(stats.total)} · {percent}
          %
        </span>
        {/* 空闲速率没有信息量；否则已完成的文件会一直
            显示两行常驻的 0 B/s。 */}
        {stats.downBps > 0 ? (
          <span
            className="flex items-center gap-1 tabular-nums"
            title={t`下载`}
          >
            <ArrowDown className="text-muted-foreground size-3" />
            {formatBytes(stats.downBps)}/s
          </span>
        ) : null}
        {stats.upBps > 0 ? (
          <span
            className="flex items-center gap-1 tabular-nums"
            title={t`上传`}
          >
            <ArrowUp className="text-muted-foreground size-3" />
            {formatBytes(stats.upBps)}/s
          </span>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground tabular-nums hover:underline"
          title={t`查看节点明细`}
          onClick={onShowPeers}
        >
          {t`节点`} {stats.peersLive}
          {stats.peersQueued > 0 ? ` (+${stats.peersQueued})` : ""}
        </button>
      </div>
      <div className="bg-muted h-1 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full transition-[width]"
          style={{
            width: `${percent}%`,
          }}
        />
      </div>
    </div>
  );
}
