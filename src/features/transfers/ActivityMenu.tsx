import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Activity, FileClock, Info } from "lucide-react";
import { useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { describeError } from "~/lib/errors";
import { type TransferState, useTransfersStore } from "~/store/transfers";

import { retryTransferRuntime } from "./runtime/transferRuntime";
import { createTransferActions } from "./transfer-actions";
import TransferItem from "./TransferItem";

export default function ActivityMenu() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const transfers = useTransfersStore((s) => s.transfers);
  const runtimeError = useTransfersStore((s) => s.runtimeError);
  const failures = transfers.filter((item) => item.status === "error").length;
  const label = failures ? t`查看活动，${failures} 个任务失败` : t`查看活动`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          title={label}
          className="relative shrink-0"
        >
          <Activity />
          {failures > 0 || runtimeError ? (
            <span
              aria-hidden
              className="bg-destructive absolute top-1 right-1 size-1.5 rounded-full"
            />
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogLayoutContent
        placement="responsive-sheet"
        showCloseButton={false}
        className="ui-density-adaptive gap-3 md:max-w-[28.75rem]"
      >
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            <Trans>活动</Trans>
          </DialogTitle>
          <DialogDescription className="sr-only">
            <Trans>查看传输任务的进度和结果</Trans>
          </DialogDescription>
        </DialogLayoutHeader>
        <ActivityBody />
        <div className="flex flex-col gap-3 border-t pt-3">
          <Alert>
            <Info />
            <AlertDescription>
              <Trans>关闭活动面板不会取消传输。</Trans>
            </AlertDescription>
          </Alert>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" className="flex-1">
              <Link to="/logs" onClick={() => setOpen(false)}>
                <FileClock data-icon="inline-start" />
                <Trans>查看日志</Trans>
              </Link>
            </Button>
            <DialogClose asChild>
              <Button variant="outline" className="flex-1">
                <Trans>关闭</Trans>
              </Button>
            </DialogClose>
          </div>
        </div>
      </DialogLayoutContent>
    </Dialog>
  );
}

function ActivityBody() {
  const transfers = useTransfersStore((s) => s.transfers);
  const runtimeError = useTransfersStore((s) => s.runtimeError);
  const [tab, setTab] = useState("running");
  const running = transfers.filter((item) => item.status === "running");
  const failed = transfers.filter((item) => item.status === "error");
  const finished = transfers.filter(
    (item) => item.status === "success" || item.status === "cancelled",
  );
  const items =
    tab === "running" ? running : tab === "error" ? failed : finished;
  return (
    <DialogLayoutBody className="flex flex-col gap-3 overflow-hidden">
      {runtimeError ? (
        <Alert variant="destructive">
          <AlertTitle>
            <Trans>任务进度同步暂不可用</Trans>
          </AlertTitle>
          <AlertDescription>
            {describeError(runtimeError)}
            <Button variant="outline" size="sm" onClick={retryTransferRuntime}>
              <Trans comment="重新连接传输进度事件监听">重试</Trans>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-3">
        <TabsList className="w-full">
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
        <TabsContent value={tab} className="min-h-0">
          {items.length ? (
            <ActivityList key={tab} items={items} />
          ) : (
            <Empty className="min-h-32">
              <EmptyHeader>
                <EmptyTitle>
                  <Trans>暂无此类任务</Trans>
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </TabsContent>
      </Tabs>
    </DialogLayoutBody>
  );
}

function ActivityList({ items }: { items: TransferState[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const actions = createTransferActions();
  // 估算只用于首次定位；实际行高持续测量，长错误与界面缩放不会造成行重叠。
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 110,
    getItemKey: (index) => items[index].id,
    overscan: 4,
  });
  return (
    <div
      ref={scrollRef}
      className="max-h-[45dvh] min-h-0 flex-1 overflow-y-auto"
      style={{ height: `min(20rem, ${virtualizer.getTotalSize()}px)` }}
      role="list"
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
