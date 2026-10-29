import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";

import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";

import { peersQuery } from "../queries";

const POLL_INTERVAL_MS = 2000;

/**
 * 节点明细浮层：每 2 秒轮询一次（节点变化频繁，事件推送会很吵）。
 * IP 已在服务端脱敏，仅用于展示。
 */
export default function PeersPanel({ infoHash }: { infoHash: string }) {
  const { t } = useLingui();
  const query = useQuery({
    ...peersQuery(infoHash),
    enabled: !!infoHash,
    refetchInterval: POLL_INTERVAL_MS,
  });
  const peers = query.data ?? null;
  const error = query.error;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="border-border min-h-40 flex-1 overflow-y-auto rounded-xl border">
        {error ? (
          <p
            role="alert"
            className="text-destructive p-4 text-xs wrap-anywhere"
          >
            {describeError(error, t)}
          </p>
        ) : peers === null ? (
          <div
            role="status"
            className="text-muted-foreground flex items-center justify-center gap-2 p-6 text-xs"
          >
            <Spinner aria-label={t`加载中`} />
            <Trans>加载中…</Trans>
          </div>
        ) : peers.length === 0 ? (
          <Empty className="h-full min-h-40 gap-0 border-0">
            <EmptyHeader>
              <EmptyTitle className="text-muted-foreground text-xs font-normal">
                <Trans>暂无连接的节点</Trans>
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table className="text-xs">
            <TableHeader className="bg-muted text-muted-foreground sticky top-0">
              <TableRow>
                <TableHead className="h-auto px-2 py-1.5">
                  <Trans>IP</Trans>
                </TableHead>
                <TableHead className="h-auto px-2 py-1.5">
                  <Trans>客户端</Trans>
                </TableHead>
                <TableHead className="h-auto px-2 py-1.5 text-right">
                  <Trans>已接收</Trans>
                </TableHead>
                <TableHead className="h-auto px-2 py-1.5 text-right">
                  <Trans>已上传</Trans>
                </TableHead>
                <TableHead className="h-auto px-2 py-1.5">
                  <Trans>状态</Trans>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {peers.map((peer) => (
                <TableRow key={peer.addr} className="border-border border-t">
                  <TableCell className="px-2 py-1.5">{peer.addr}</TableCell>
                  <TableCell
                    className="max-w-32 truncate px-2 py-1.5"
                    title={peer.clientName ?? undefined}
                  >
                    {peer.clientName ?? "--"}
                  </TableCell>
                  <TableCell className="px-2 py-1.5 text-right">
                    {formatBytes(peer.fetchedBytes)}
                  </TableCell>
                  <TableCell className="px-2 py-1.5 text-right">
                    {formatBytes(peer.uploadedBytes)}
                  </TableCell>
                  <TableCell className="text-muted-foreground px-2 py-1.5">
                    {peer.state}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <span className="text-muted-foreground text-right text-xs">
        <Trans>每 2 秒刷新 · IP 已脱敏</Trans>
      </span>
    </div>
  );
}
