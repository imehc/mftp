import { useEffect, useEffectEvent, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { FolderOpen, LoaderCircle, Magnet } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import type { BtFileMeta, BtProbeResult, BtTaskInfo } from "~/types";
import * as ipc from "~/lib/ipc";
import { formatBytes } from "~/lib/format";
import { cn } from "~/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { systemDownloadDir } from "../file-actions";
import TorrentFileList from "./TorrentFileList";
export interface AddTorrentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 在媒体文件上点击预览；携带对话框当前的来源。 */
  onPreview: (source: string, file: BtFileMeta, probe: BtProbeResult) => void;
  onAdded: (task: BtTaskInfo) => void;
  /** 预填的来源（任务行的磁力链接）：对话框一打开就探测，
   *  之后的流程与手动添加一致。 */
  initialSource?: string | null;
  initialProbe?: BtProbeResult | null;
}

/**
 * 添加流程：磁力链接 / .torrent 输入 → bt_probe 文件树 → 选择 →
 * 目标目录 → bt_add_download。任务进入底部传输面板（id 前缀 bt:）。
 *
 * 用已有任务的磁力链接打开时复用同一流程：探测通过引擎已管理的
 * 种子解析（不会写入磁盘），而 bt_tasks 以 infohash 为键，
 * 因此不会出现重复记录。
 */
export default function AddTorrentDialog({
  open,
  onOpenChange,
  onPreview,
  onAdded,
  initialSource,
  initialProbe,
}: AddTorrentDialogProps) {
  const { t } = useLingui();
  const [source, setSource] = useState("");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<BtProbeResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [destDir, setDestDir] = useState("");
  const [starting, setStarting] = useState(false);
  // 仅在带 initialSource 时有意义：失败时回到输入步骤，
  // 这样磁力链接可被重新解析，而不是一直转圈。
  const [probeFailed, setProbeFailed] = useState(false);
  const reset = () => {
    setSource("");
    setProbing(false);
    setProbe(null);
    setSelected(new Set());
    setDestDir("");
    setStarting(false);
    setProbeFailed(false);
  };
  const close = () => {
    onOpenChange(false);
    // 延后重置，避免关闭动画期间内容闪成空白。
    setTimeout(reset, 200);
  };
  const doProbe = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const apply = (result: BtProbeResult) => {
      setProbe(result);
      // 默认全选所有文件。
      setSelected(new Set(result.files.map((f) => f.index)));
    };
    setProbeFailed(false);
    setProbing(true);
    try {
      const result = await ipc.btProbe(trimmed);
      apply(result);
    } catch (error) {
      setProbeFailed(true);
      toast.error(t`获取资源信息失败`, {
        description: String(error),
      });
    } finally {
      setProbing(false);
    }
  };
  const pickTorrent = async () => {
    const picked = await openDialog({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Torrent",
          extensions: ["torrent"],
        },
      ],
    });
    if (typeof picked === "string") {
      setSource(picked);
      await doProbe(picked);
    }
  };

  // 从任务行打开：完全跳过输入步骤 —— 显示加载状态并在后台
  // 探测。该值是普通字符串，在 BT 页轮询重渲染时保持稳定。
  const doProbeOnOpen = useEffectEvent(doProbe);
  useEffect(() => {
    if (!open || !initialSource) return;
    // 用微任务延后，使重置发生在 effect 函数体之外。
    queueMicrotask(() => {
      setProbe(null);
      setSource(initialSource);
      if (initialProbe) {
        setProbe(initialProbe);
        setSelected(new Set(initialProbe.files.map((file) => file.index)));
        return;
      }
      // 用最新闭包探测，且不在 doProbe 身份变化时重跑。
      void doProbeOnOpen(initialSource);
    });
  }, [initialProbe, initialSource, open]);
  // 保存位置默认跟随系统下载文件夹。用 setState 回调判空，这样在解析
  // 返回之前就自己选了目录的情况下不会被覆盖。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void systemDownloadDir().then((dir) => {
      if (!cancelled && dir) setDestDir((prev) => prev || dir);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);
  const toggleFile = (index: number) => {
    if (index < 0 || !probe) {
      // -1 = 来自表头行的“全选”信号：依据当前是否已全选来整体翻转。
      setSelected((prev) =>
        prev.size === (probe?.files.length ?? 0)
          ? new Set()
          : new Set(probe?.files.map((f) => f.index) ?? []),
      );
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  };
  const pickDestDir = async () => {
    const picked = await openDialog({
      multiple: false,
      directory: true,
      defaultPath: destDir || undefined,
    });
    if (typeof picked === "string") setDestDir(picked);
  };
  const selectedBytes = (() => {
    if (!probe) return 0;
    return probe.files
      .filter((f) => selected.has(f.index))
      .reduce((sum, f) => sum + f.len, 0);
  })();
  const startDownload = async () => {
    if (!probe || !destDir.trim() || selected.size === 0) return;
    setStarting(true);
    try {
      const task = await ipc.btAddDownload(
        source.trim(),
        probe.infoHash,
        [...selected].sort((a, b) => a - b),
        destDir,
      );
      onAdded(task);
      toast.success(t`任务已添加，可在传输面板查看进度`);
      close();
    } catch (error) {
      toast.error(t`添加下载任务失败`, {
        description: String(error),
      });
    } finally {
      setStarting(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent
        className={cn(
          "flex max-h-[85dvh] min-h-0 flex-col overflow-hidden sm:max-w-lg",
          probe && "h-[min(85dvh,40rem)]",
        )}
      >
        {/* 从任务行打开时无需标题介绍：标题仅为辅助技术保留，
            种子名就显示在下方。 */}
        <DialogHeader className={initialSource ? "sr-only" : undefined}>
          <DialogTitle>
            {initialSource ? (
              (probe?.name ?? <Trans>加载中…</Trans>)
            ) : (
              <Trans>添加 BT 任务</Trans>
            )}
          </DialogTitle>
          <DialogDescription>
            <Trans>支持磁力链接与本地 .torrent 文件</Trans>
          </DialogDescription>
        </DialogHeader>

        {!probe ? (
          initialSource && !probeFailed ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-xs">
              <LoaderCircle className="size-3.5 animate-spin" />
              <Trans>加载中…</Trans>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder={t`磁力链接`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && source.trim())
                      void doProbe(source);
                  }}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={pickTorrent}
                  title={t`选择种子文件`}
                  aria-label={t`选择种子文件`}
                >
                  <FolderOpen />
                </Button>
              </div>
              <Button
                disabled={!source.trim() || probing}
                onClick={() => void doProbe(source)}
              >
                {probing ? (
                  <LoaderCircle
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : (
                  <Magnet data-icon="inline-start" />
                )}
                {probing ? t`正在获取资源信息…` : t`解析`}
              </Button>
            </div>
          )
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div
              className={cn(
                "flex shrink-0 items-baseline justify-between gap-2 px-1",
                // 这里上方没有标题，因此留出空间给对话框
                // 浮动的关闭按钮。
                initialSource && "pr-8",
              )}
            >
              <span className="min-w-0 truncate text-sm font-medium">
                {probe.name}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {formatBytes(selectedBytes)} / {formatBytes(probe.totalLen)}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <TorrentFileList
                files={probe.files}
                selected={selected}
                onToggle={toggleFile}
                onPreview={(file) => onPreview(source.trim(), file, probe)}
              />
            </div>
            <div className="flex shrink-0 gap-2">
              <Input
                value={destDir}
                onChange={(e) => setDestDir(e.target.value)}
                placeholder={t`选择保存位置`}
                readOnly
              />
              <Button
                variant="outline"
                size="icon"
                onClick={pickDestDir}
                title={t`选择保存位置`}
                aria-label={t`选择保存位置`}
              >
                <FolderOpen />
              </Button>
            </div>
            {/* 下载中的文件在隐藏暂存目录里，下完才迁入这里；不说明的话
                用户会以为没在下载。 */}
            <p className="text-muted-foreground shrink-0 text-xs">
              <Trans>下载完成后才写入该目录</Trans>
            </p>
            <DialogFooter className="shrink-0">
              <Button variant="ghost" onClick={close}>
                <Trans>取消</Trans>
              </Button>
              <Button
                disabled={selected.size === 0 || !destDir.trim() || starting}
                onClick={() => void startDownload()}
              >
                {starting ? (
                  <LoaderCircle
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : null}
                <Trans>下载</Trans>
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
