import { Trans, useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { retryTransferRuntime } from "~/features/transfers/runtime/transferRuntime";
import { createTransferActions } from "~/features/transfers/transfer-actions";
import TransferItem from "~/features/transfers/TransferItem";
import { describeError } from "~/lib/errors";
import { useVirtualizerFontSize } from "~/lib/root-font-size";
import { type TransferState, useTransfersStore } from "~/store/transfers";

import {
  type TransferFilter,
  useActivityViewStore,
} from "./activity-view-store";

export default function TransferActivity() {
  const { t } = useLingui();
  const transfers = useTransfersStore((state) => state.transfers);
  const runtimeError = useTransfersStore((state) => state.runtimeError);
  const running = transfers.filter((item) => item.status === "running");
  const failed = transfers.filter((item) => item.status === "error");
  const finished = transfers.filter(
    (item) => item.status === "success" || item.status === "cancelled",
  );
  const filter = useActivityViewStore((state) => state.transferFilter);
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
            <p className="wrap-break-word">{describeError(runtimeError, t)}</p>
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
      <div className="flex min-h-0 flex-1 flex-col">
        {items.length ? (
          <TransferList items={items} actions={actions} />
        ) : (
          <TransferEmpty filter={filter} />
        )}
      </div>
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
  // 更新与同步卡片是任务面板的直属 section；按实际渲染结果避让，兼顾可关闭的同步错误。
  return (
    <Empty className="min-h-32 flex-1 group-has-[>section]/activity-tasks:hidden">
      <EmptyHeader>
        {filter === "running" ? (
          <EmptyTitle>
            <Trans comment="活动页传输中筛选的空状态">暂无任务</Trans>
          </EmptyTitle>
        ) : filter === "error" ? (
          <EmptyTitle>
            <Trans comment="活动页失败筛选的空状态">暂无失败任务</Trans>
          </EmptyTitle>
        ) : (
          <EmptyTitle>
            <Trans comment="活动页已结束筛选的空状态">暂无已结束任务</Trans>
          </EmptyTitle>
        )}
      </EmptyHeader>
    </Empty>
  );
}
