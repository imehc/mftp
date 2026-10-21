import { Trans } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { retryTransferRuntime } from "~/features/transfers/runtime/transferRuntime";
import { createTransferActions } from "~/features/transfers/transfer-actions";
import TransferItem from "~/features/transfers/TransferItem";
import { describeError } from "~/lib/errors";
import { useVirtualizerFontSize } from "~/lib/root-font-size";
import { type TransferState, useTransfersStore } from "~/store/transfers";

type TransferFilter = "running" | "error" | "finished";

export default function TransferActivity() {
  const transfers = useTransfersStore((state) => state.transfers);
  const runtimeError = useTransfersStore((state) => state.runtimeError);
  const clearFinished = useTransfersStore((state) => state.clearFinished);
  const running = transfers.filter((item) => item.status === "running");
  const failed = transfers.filter((item) => item.status === "error");
  const finished = transfers.filter(
    (item) => item.status === "success" || item.status === "cancelled",
  );
  const [filter, setFilter] = useState<TransferFilter>(() =>
    failed.length ? "error" : "running",
  );
  const actions = createTransferActions();
  const items =
    filter === "running" ? running : filter === "error" ? failed : finished;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {runtimeError ? (
        <Alert variant="destructive" className="shrink-0">
          <AlertTitle>
            <Trans>任务进度同步暂不可用</Trans>
          </AlertTitle>
          <AlertDescription>
            <p className="wrap-break-word">{describeError(runtimeError)}</p>
            <Button
              variant="outline"
              size="sm"
              density="adaptive"
              className="mt-2"
              onClick={retryTransferRuntime}
            >
              <Trans comment="重新连接传输进度事件监听">重试</Trans>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <Tabs
        value={filter}
        onValueChange={(value) => setFilter(value as TransferFilter)}
        className="min-h-0 flex-1 gap-2"
      >
        <TabsList className="w-full shrink-0">
          <TabsTrigger value="running">
            <Trans>进行中</Trans>
            <Badge variant="secondary">{running.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="error">
            <Trans>失败</Trans>
            <Badge variant="secondary">{failed.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="finished">
            <Trans>已结束</Trans>
            <Badge variant="secondary">{finished.length}</Badge>
          </TabsTrigger>
        </TabsList>
        {filter === "finished" && finished.length ? (
          <div className="flex shrink-0 justify-end">
            <Button
              variant="ghost"
              size="sm"
              density="adaptive"
              onClick={clearFinished}
            >
              <Trash2 data-icon="inline-start" aria-hidden />
              <Trans>清除已结束</Trans>
            </Button>
          </div>
        ) : null}
        <TabsContent value={filter} className="flex min-h-0 flex-1 flex-col">
          {items.length ? (
            <TransferList items={items} actions={actions} />
          ) : (
            <TransferEmpty filter={filter} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TransferList({
  items,
  actions,
}: {
  items: TransferState[];
  actions: ReturnType<typeof createTransferActions>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // 估算只用于首次定位；实际行高持续测量，长错误与界面缩放不会造成行重叠。
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 110,
    getItemKey: (index) => items[index].id,
    overscan: 4,
  });
  useVirtualizerFontSize(virtualizer);
  return (
    <div
      ref={scroller}
      role="list"
      className="app-scroll-safe-end min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              role="listitem"
              className="absolute top-0 left-0 w-full pb-2"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <TransferItem
                spacious
                transfer={item}
                onCancel={() => void actions.cancelTransfer(item)}
                onTogglePause={actions.togglePause}
                onRetry={actions.retryTransfer}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TransferEmpty({ filter }: { filter: TransferFilter }) {
  const content =
    filter === "running"
      ? {
          title: <Trans>没有正在传输的任务</Trans>,
          description: <Trans>开始上传或下载后，进度会显示在这里。</Trans>,
        }
      : filter === "error"
        ? {
            title: <Trans>没有失败的任务</Trans>,
            description: (
              <Trans>传输失败后会保留在这里，便于重试或查看原因。</Trans>
            ),
          }
        : {
            title: <Trans>还没有已结束的任务</Trans>,
            description: <Trans>完成或取消的任务会出现在这里。</Trans>,
          };
  return (
    <Empty className="min-h-32 flex-1">
      <EmptyHeader>
        <EmptyTitle>{content.title}</EmptyTitle>
        <EmptyDescription>{content.description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
