import { useEffect, useState } from "react";
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
  task: {
    infoHash: string;
    label: string;
  } | null;
  onClose: () => void;
}
const POLL_INTERVAL_MS = 2000;

/**
 * 节点明细浮层：每 2 秒轮询一次（节点变化频繁，事件推送会很吵）。
 * IP 已在服务端脱敏，仅用于展示。
 */
export default function PeersDialog({ task, onClose }: PeersDialogProps) {
  const [peers, setPeers] = useState<BtPeerInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!task) return;
    const poll = async (hash: string) => {
      try {
        setPeers(await ipc.btTaskPeers(hash));
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    };
    // 用微任务延后，使重置发生在 effect 函数体之外。
    queueMicrotask(() => {
      setPeers(null);
      setError(null);
      void poll(task.infoHash);
    });
    const timer = setInterval(() => void poll(task.infoHash), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [task]);
  if (!task) return null;
  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-2 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="min-w-0 truncate pr-6" title={task.label}>
            <Trans>节点明细</Trans>
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {task.label}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="border-border min-h-40 flex-1 overflow-y-auto rounded-md border">
          {error ? (
            <div className="text-destructive p-4 text-xs">{error}</div>
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
        <span className="text-muted-foreground text-right text-[10px]">
          <Trans>每 2 秒刷新 · IP 已脱敏</Trans>
        </span>
      </DialogContent>
    </Dialog>
  );
}
