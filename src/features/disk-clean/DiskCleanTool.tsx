import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { gsap } from "gsap";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import { formatBytes } from "~/lib/format";
import { prefersReducedMotion } from "~/lib/motion";
import * as ipc from "~/lib/ipc";
import { AnalyzePanel } from "./AnalyzePanel";
import { AnimatedBytes } from "./AnimatedBytes";
import RemoveConfirmDialog from "./RemoveConfirmDialog";
import { RulePicker } from "./RulePicker";
import { ScanResultTable } from "./ScanResultTable";
import { useDiskCleanStore } from "./store";
import { useDiskScan } from "./useDiskScan";

/** Rule-driven cleanup vs read-only directory analysis. */
type Mode = "clean" | "analyze";

/** Ring geometry; r is chosen so the 44px box has room for the stroke. */
const RING_R = 18;
const RING_C = 2 * Math.PI * RING_R;

function VolumeRing() {
  const volume = useDiskCleanStore((s) => s.volume);
  const arcRef = useRef<SVGCircleElement>(null);
  const usedRatio =
    volume && volume.totalBytes > 0 ? volume.usedBytes / volume.totalBytes : 0;

  // Sweep the arc to the new ratio. Runs again after a clean frees space.
  useEffect(() => {
    const arc = arcRef.current;
    if (!arc) return;
    const target = RING_C * (1 - Math.min(1, usedRatio));
    gsap.killTweensOf(arc);
    if (prefersReducedMotion()) {
      gsap.set(arc, { strokeDashoffset: target });
      return;
    }
    gsap.to(arc, {
      strokeDashoffset: target,
      duration: 0.7,
      ease: "power2.out",
    });
    return () => {
      gsap.killTweensOf(arc);
    };
  }, [usedRatio]);

  if (!volume) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 rounded-lg border border-border bg-card p-2.5">
      <svg
        viewBox="0 0 44 44"
        className="size-11 shrink-0 -rotate-90"
        role="img"
        aria-label={`${Math.round(usedRatio * 100)}%`}
      >
        <circle
          cx="22"
          cy="22"
          r={RING_R}
          fill="none"
          className="stroke-muted"
          strokeWidth="4"
        />
        <circle
          ref={arcRef}
          cx="22"
          cy="22"
          r={RING_R}
          fill="none"
          className="stroke-primary"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={RING_C}
          // Start empty; the tween fills it in.
          strokeDashoffset={RING_C}
        />
      </svg>
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-muted-foreground">
          <Trans>可用空间</Trans>
        </span>
        <span className="truncate text-sm tabular-nums">
          {formatBytes(volume.freeBytes)} / {formatBytes(volume.totalBytes)}
        </span>
      </div>
    </div>
  );
}

function ScanStatus() {
  const phase = useDiskCleanStore((s) => s.phase);
  const counters = useDiskCleanStore((s) => s.counters);
  const error = useDiskCleanStore((s) => s.error);

  if (!phase) return null;

  if (phase === "expanding" || phase === "running") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {phase === "expanding" ? (
          // Expansion walks $HOME and reports no counters, so say what is
          // happening rather than showing zeros that look stuck.
          <Trans>正在查找…</Trans>
        ) : (
          <Trans>
            已扫描 {counters.scannedFiles} 个文件 ·{" "}
            <AnimatedBytes bytes={counters.totalBytes} />
          </Trans>
        )}
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <p className="text-xs text-destructive">{error ?? <Trans>扫描失败</Trans>}</p>
    );
  }

  if (phase === "canceled") {
    return (
      <p className="text-xs text-muted-foreground">
        <Trans>已取消</Trans>
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>
        <Trans>共 {formatBytes(counters.totalBytes)}</Trans>
      </span>
      {counters.skipped > 0 ? (
        // TCC blocks ~/Documents and friends without Full Disk Access; say so
        // rather than silently under-reporting.
        <span>
          <Trans>
            {counters.skipped} 项无权限已跳过，可在「系统设置 &gt; 隐私与安全性 &gt;
            完全磁盘访问权限」中授权
          </Trans>
        </span>
      ) : null}
    </div>
  );
}

export default function DiskCleanTool() {
  const { t } = useLingui();
  const { start, cancel } = useDiskScan();
  const phase = useDiskCleanStore((s) => s.phase);
  const items = useDiskCleanStore((s) => s.items);
  const jobId = useDiskCleanStore((s) => s.jobId);
  const selectedPaths = useDiskCleanStore((s) => s.selectedPaths);
  const removePaths = useDiskCleanStore((s) => s.removePaths);
  const setVolume = useDiskCleanStore((s) => s.setVolume);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [permanent, setPermanent] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [mode, setMode] = useState<Mode>("clean");

  const scanning = phase === "expanding" || phase === "running";

  const selectedBytes = useMemo(
    () =>
      items
        .filter((item) => selectedPaths.has(item.path))
        .reduce((sum, item) => sum + item.bytes, 0),
    [items, selectedPaths],
  );

  const openConfirm = () => {
    // Permanent is opt-in per operation, never sticky across dialogs.
    setPermanent(false);
    setConfirmOpen(true);
  };

  const confirmRemove = async () => {
    if (!jobId) return;
    setRemoving(true);
    try {
      const paths = Array.from(selectedPaths);
      const report = await ipc.diskCleanRemove(jobId, paths, permanent);
      removePaths(report.removed.map((entry) => entry.path));
      if (report.failed.length > 0) {
        toast.error(report.failed[0]?.reason ?? t`部分项目未能清理`);
      } else {
        toast.success(t`已清理 ${formatBytes(report.freedBytes)}`);
      }
      // Freed space only shows up in a fresh stat.
      setVolume(await ipc.diskCleanVolume());
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRemoving(false);
      setConfirmOpen(false);
    }
  };

  return (
    <main className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to="/" aria-label={t`返回首页`} title={t`返回首页`}>
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">
              <Trans>磁盘清理</Trans>
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              <Trans>找出可安全删除的缓存</Trans>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Analyze mode has its own picker and produces no deletable job,
              so the scan/clean pair would act on nothing. */}
          {mode === "clean" ? (
            <>
              {scanning ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void cancel()}
                >
                  <Trans>取消</Trans>
                </Button>
              ) : (
                <Button size="sm" onClick={() => void start()}>
                  <Trans>开始扫描</Trans>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={selectedPaths.size === 0 || scanning}
                onClick={openConfirm}
              >
                <Trash2 data-icon="inline-start" />
                <Trans>清理</Trans>
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4">
        <VolumeRing />
        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as Mode)}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <TabsList className="shrink-0 self-start">
            <TabsTrigger value="clean">
              <Trans>按规则清理</Trans>
            </TabsTrigger>
            <TabsTrigger value="analyze">
              <Trans>分析目录</Trans>
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="clean"
            className="flex min-h-0 flex-1 flex-col gap-3"
          >
            <ScanStatus />
            {items.length > 0 ? (
              <ScanResultTable />
            ) : (
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card p-2.5">
                <RulePicker scanning={scanning} />
              </div>
            )}
            {selectedPaths.size > 0 ? (
              <p className="shrink-0 text-xs text-muted-foreground">
                <Trans>
                  已选 {selectedPaths.size} 项 · {formatBytes(selectedBytes)}
                </Trans>
              </p>
            ) : null}
          </TabsContent>

          <TabsContent
            value="analyze"
            className="flex min-h-0 flex-1 flex-col gap-3"
          >
            <AnalyzePanel />
          </TabsContent>
        </Tabs>
      </div>

      <RemoveConfirmDialog
        open={confirmOpen}
        count={selectedPaths.size}
        bytes={selectedBytes}
        permanent={permanent}
        busy={removing}
        onPermanentChange={setPermanent}
        onOpenChange={setConfirmOpen}
        onConfirm={() => void confirmRemove()}
      />
    </main>
  );
}
