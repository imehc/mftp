import { useCallback, useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { LoaderCircle } from "lucide-react";
import type { BtPeerInfo } from "~/types";
import * as ipc from "~/lib/ipc";
import { formatBytes } from "~/lib/format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

export interface PeersDialogProps {
  task: { infoHash: string; label: string } | null;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 2000;

/**
 * Peer details overlay: polls every 2s (peer churn is frequent and event
 * pushes would be noisy). IPs are masked server-side; display only.
 */
export default function PeersDialog({ task, onClose }: PeersDialogProps) {
  const [peers, setPeers] = useState<BtPeerInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async (hash: string) => {
    try {
      setPeers(await ipc.btTaskPeers(hash));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (!task) return;
    setPeers(null);
    setError(null);
    void poll(task.infoHash);
    timer.current = setInterval(() => void poll(task.infoHash), POLL_INTERVAL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [poll, task]);

  if (!task) return null;

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-2 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="min-w-0 truncate pr-6" title={task.label}>
            <Trans>节点明细</Trans>
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {task.label}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-40 flex-1 overflow-y-auto rounded-md border border-border">
          {error ? (
            <div className="p-4 text-xs text-destructive">{error}</div>
          ) : peers === null ? (
            <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              <Trans>加载中…</Trans>
            </div>
          ) : peers.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              <Trans>暂无连接的节点</Trans>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">IP</th>
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
                  <tr key={peer.addr} className="border-t border-border">
                    <td className="px-2 py-1.5">{peer.addr}</td>
                    <td className="max-w-32 truncate px-2 py-1.5" title={peer.clientName ?? undefined}>
                      {peer.clientName ?? "--"}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {formatBytes(peer.fetchedBytes)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {formatBytes(peer.uploadedBytes)}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {peer.state}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <span className="text-right text-[10px] text-muted-foreground">
          <Trans>每 2 秒刷新 · IP 已脱敏</Trans>
        </span>
      </DialogContent>
    </Dialog>
  );
}
