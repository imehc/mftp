import { useEffect, useState } from "react";
import { createPoller } from "~/lib/polling";
import { describeError, toIpcError } from "~/lib/errors";
import { Trans } from "@lingui/react/macro";
import { LoaderCircle } from "lucide-react";
import type { AppError, BtPeerInfo } from "~/types";
import * as ipc from "~/lib/ipc";
import { formatBytes } from "~/lib/format";
const POLL_INTERVAL_MS = 2000;

/**
 * 节点明细浮层：每 2 秒轮询一次（节点变化频繁，事件推送会很吵）。
 * IP 已在服务端脱敏，仅用于展示。
 */
export default function PeersPanel({ infoHash }: { infoHash: string }) {
  const [peers, setPeers] = useState<BtPeerInfo[] | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  useEffect(() => {
    const hash = infoHash;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await ipc.btTaskPeers(hash);
        if (!cancelled) {
          setPeers(result);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError(toIpcError(cause).payload);
      }
    };
    // 用微任务延后，使重置发生在 effect 函数体之外。
    queueMicrotask(() => {
      if (cancelled) return;
      setPeers(null);
      setError(null);
    });
    // 串行轮询：慢链路下不堆叠请求，页面不可见时暂停。
    const poller = createPoller(poll, {
      intervalMs: POLL_INTERVAL_MS,
      pauseWhenHidden: true,
    });
    return () => {
      cancelled = true;
      poller.stop();
    };
  }, [infoHash]);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="border-border min-h-40 flex-1 overflow-y-auto rounded-md border">
        {error ? (
          <div className="text-destructive p-4 text-xs">
            {describeError(error)}
          </div>
        ) : peers === null ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 p-6 text-xs">
            <LoaderCircle className="size-3.5 animate-spin" />
            <Trans>加载中…</Trans>
          </div>
        ) : peers.length === 0 ? (
          <div className="text-muted-foreground p-4 text-center text-xs">
            <Trans>暂无连接的节点</Trans>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-muted text-muted-foreground sticky top-0">
              <tr>
                <th className="px-2 py-1.5 font-medium">
                  <Trans>IP</Trans>
                </th>
                <th className="px-2 py-1.5 font-medium">
                  <Trans>客户端</Trans>
                </th>
                <th className="px-2 py-1.5 text-right font-medium">
                  <Trans>已接收</Trans>
                </th>
                <th className="px-2 py-1.5 text-right font-medium">
                  <Trans>已上传</Trans>
                </th>
                <th className="px-2 py-1.5 font-medium">
                  <Trans>状态</Trans>
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {peers.map((peer) => (
                <tr key={peer.addr} className="border-border border-t">
                  <td className="px-2 py-1.5">{peer.addr}</td>
                  <td
                    className="max-w-32 truncate px-2 py-1.5"
                    title={peer.clientName ?? undefined}
                  >
                    {peer.clientName ?? "--"}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {formatBytes(peer.fetchedBytes)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {formatBytes(peer.uploadedBytes)}
                  </td>
                  <td className="text-muted-foreground px-2 py-1.5">
                    {peer.state}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <span className="text-muted-foreground text-right text-xs">
        <Trans>每 2 秒刷新 · IP 已脱敏</Trans>
      </span>
    </div>
  );
}
