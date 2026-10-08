import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { gsap } from "gsap";
import {
  ChevronDown,
  ListChecks,
  Pause,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { retryTransferRuntime } from "~/features/transfers/runtime/transferRuntime";
import { describeError } from "~/lib/errors";
import { prefersReducedMotion } from "~/lib/motion";
import { useTransfersStore } from "~/store/transfers";

import { createTransferActions } from "./transfer-actions";
import { transferMetrics } from "./transfer-metrics";
import TransferItem from "./TransferItem";

export interface TransferPanelProps {
  animateOnMount?: boolean;
}

export default function TransferPanel({
  animateOnMount = true,
}: TransferPanelProps) {
  const { t } = useLingui();
  const contentRef = useRef<HTMLDivElement>(null);
  const transfers = useTransfersStore((s) => s.transfers);
  const clearFinished = useTransfersStore((s) => s.clearFinished);
  const runtimeError = useTransfersStore((s) => s.runtimeError);
  const [open, setOpen] = useState(true);
  const animationEnabledRef = useRef(animateOnMount);
  const activeTransferCount = transfers.filter(
    (t) => t.status === "running",
  ).length;
  const pausedTransferCount = transfers.filter(
    (t) => t.status === "running" && t.paused,
  ).length;
  const transferringCount = activeTransferCount - pausedTransferCount;
  const finishedTransferCount = transfers.length - activeTransferCount;
  const latestTransfer =
    transfers.find((t) => t.status === "running") ?? transfers[0];
  const latestMetrics = latestTransfer ? transferMetrics(latestTransfer) : null;
  const transferStatusLabel =
    activeTransferCount === 0
      ? t`空闲`
      : transferringCount === 0
        ? t({
            message: plural(
              {
                pausedTransferCount,
              },
              {
                one: "# 个已暂停",
                other: "# 个已暂停",
              },
            ),
          })
        : pausedTransferCount > 0
          ? t({
              message: plural(
                {
                  transferringCount,
                },
                {
                  one: `# 个进行中 · ${pausedTransferCount} 个已暂停`,
                  other: `# 个进行中 · ${pausedTransferCount} 个已暂停`,
                },
              ),
            })
          : t({
              message: plural(
                {
                  transferringCount,
                },
                {
                  one: "# 个进行中",
                  other: "# 个进行中",
                },
              ),
            });
  const clearFinishedLabel = t({
    message: plural(
      {
        finishedTransferCount,
      },
      {
        one: "清除 # 个已完成任务",
        other: "清除 # 个已完成任务",
      },
    ),
  });
  // 进度事件由应用运行期的 transferRuntime 统一订阅：面板没挂载时
  // （例如停留在设置页）进度也不能丢。
  // 传输进行中时自动展开；放在渲染阶段调整（React 的
  // “在 prop 变化时调整 state”模式），而不是用 effect。
  const [prevActiveCount, setPrevActiveCount] = useState(activeTransferCount);
  if (prevActiveCount !== activeTransferCount) {
    setPrevActiveCount(activeTransferCount);
    if (activeTransferCount > 0) setOpen(true);
  }
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    gsap.killTweensOf(content);
    const reduceMotion = prefersReducedMotion();
    if (reduceMotion || !animationEnabledRef.current) {
      gsap.set(content, {
        display: open ? "block" : "none",
        clearProps: "height,opacity,transform",
      });
      return;
    }
    if (open) {
      gsap.set(content, {
        display: "block",
        height: "auto",
      });
      const height = content.offsetHeight;
      gsap.fromTo(
        content,
        {
          height: 0,
          opacity: 0,
          y: -6,
        },
        {
          height,
          opacity: 1,
          y: 0,
          duration: 0.34,
          ease: "power3.out",
          onComplete: () =>
            gsap.set(content, {
              height: "auto",
            }),
        },
      );
    } else {
      gsap.to(content, {
        height: 0,
        opacity: 0,
        y: -4,
        duration: 0.22,
        ease: "power2.inOut",
        onComplete: () =>
          gsap.set(content, {
            display: "none",
          }),
      });
    }
    return () => gsap.killTweensOf(content);
  }, [open]);
  const { cancelTransfer, togglePause, retryTransfer } =
    createTransferActions();
  if (transfers.length === 0) return null;
  return (
    <div className="border-border bg-sidebar border-t">
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          className="text-muted-foreground hover:bg-sidebar-accent flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs"
          onClick={() => {
            animationEnabledRef.current = true;
            setOpen((value) => !value);
          }}
          aria-expanded={open}
          aria-controls="transfer-panel-content"
        >
          {transferringCount > 0 ? (
            <RefreshCw className="size-3 animate-spin" />
          ) : pausedTransferCount > 0 ? (
            <Pause className="size-3" />
          ) : (
            <ListChecks className="size-3" />
          )}
          <span className="text-foreground font-medium">
            <Trans>传输</Trans>
          </span>
          <span className="shrink-0">{transferStatusLabel}</span>
          {latestTransfer && latestMetrics?.percent != null ? (
            <span className="min-w-0 flex-1 truncate tabular-nums">
              {latestTransfer.label} · {latestMetrics.percent}%
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <ChevronDown
            className={cn(
              "size-3 transition-transform duration-300 motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
        {finishedTransferCount > 0 ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={clearFinished}
            title={clearFinishedLabel}
            aria-label={clearFinishedLabel}
          >
            <Trash2 data-icon="inline-start" />
            <Trans>清除 {finishedTransferCount}</Trans>
          </Button>
        ) : null}
      </div>
      <div
        id="transfer-panel-content"
        ref={contentRef}
        className="overflow-hidden"
      >
        <div className="flex max-h-[min(16rem,32vh)] flex-col gap-2 overflow-y-auto px-2 pt-1 pb-2">
          {runtimeError ? (
            <Alert variant="destructive">
              <AlertTitle>
                <Trans>任务进度同步暂不可用</Trans>
              </AlertTitle>
              <AlertDescription>{describeError(runtimeError)}</AlertDescription>
              <AlertAction>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={retryTransferRuntime}
                >
                  <Trans comment="重新连接传输进度事件监听">重试</Trans>
                </Button>
              </AlertAction>
            </Alert>
          ) : null}
          {transfers.map((item) => (
            <TransferItem
              key={item.id}
              transfer={item}
              onCancel={() => void cancelTransfer(item)}
              onTogglePause={togglePause}
              onRetry={retryTransfer}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
