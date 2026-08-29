import { useCallback, useEffect, useMemo, useState } from "react";
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
import TorrentFileList from "./TorrentFileList";

export interface AddTorrentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preview click on a media file; carries the dialog's current source. */
  onPreview: (source: string, file: BtFileMeta, probe: BtProbeResult) => void;
  onAdded: (task: BtTaskInfo) => void;
  /** Prefilled source (a task row's magnet): probed as soon as the dialog
   *  opens, the flow afterwards is the same as adding by hand. */
  initialSource?: string | null;
  initialProbe?: BtProbeResult | null;
}

/**
 * Add flow: magnet/.torrent input -> bt_probe file tree -> selection ->
 * destination dir -> bt_add_download. The task lands in the bottom
 * transfer panel (id prefix bt:).
 *
 * Opening it on an existing task's magnet reuses the very same flow: probe
 * resolves through the engine's already-managed torrent (nothing written to
 * disk) and bt_tasks is keyed by infohash, so no duplicate record appears.
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
  // Only relevant with initialSource: on failure the input step comes back so
  // the magnet can be re-parsed instead of spinning forever.
  const [probeFailed, setProbeFailed] = useState(false);

  const reset = useCallback(() => {
    setSource("");
    setProbing(false);
    setProbe(null);
    setSelected(new Set());
    setDestDir("");
    setStarting(false);
    setProbeFailed(false);
  }, []);

  const close = useCallback(() => {
    onOpenChange(false);
    // Delayed reset so content does not flash empty during the close
    // animation.
    setTimeout(reset, 200);
  }, [onOpenChange, reset]);

  const doProbe = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const apply = (result: BtProbeResult) => {
        setProbe(result);
        // Select all files by default.
        setSelected(new Set(result.files.map((f) => f.index)));
      };
      setProbeFailed(false);
      setProbing(true);
      try {
        const result = await ipc.btProbe(trimmed);
        apply(result);
      } catch (error) {
        setProbeFailed(true);
        toast.error(t`获取资源信息失败`, { description: String(error) });
      } finally {
        setProbing(false);
      }
    },
    [t],
  );

  const pickTorrent = useCallback(async () => {
    const picked = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Torrent", extensions: ["torrent"] }],
    });
    if (typeof picked === "string") {
      setSource(picked);
      await doProbe(picked);
    }
  }, [doProbe]);

  // Opened from a task row: skip the input step entirely — show the loading
  // state and probe in the background. The value is a plain string, stable
  // across the BT page's polling re-renders.
  useEffect(() => {
    if (!open || !initialSource) return;
    setProbe(null);
    setSource(initialSource);
    if (initialProbe) {
      setProbe(initialProbe);
      setSelected(new Set(initialProbe.files.map((file) => file.index)));
      return;
    }
    void doProbe(initialSource);
  }, [doProbe, initialProbe, initialSource, open]);

  const toggleFile = useCallback((index: number) => {
    if (index < 0 || !probe) {
      // -1 = select-all signal from the header row: flip wholesale based on
// whether everything is currently selected.
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
  }, [probe]);

  const pickDestDir = useCallback(async () => {
    const picked = await openDialog({ multiple: false, directory: true });
    if (typeof picked === "string") setDestDir(picked);
  }, []);

  const selectedBytes = useMemo(() => {
    if (!probe) return 0;
    return probe.files
      .filter((f) => selected.has(f.index))
      .reduce((sum, f) => sum + f.len, 0);
  }, [probe, selected]);

  const startDownload = useCallback(async () => {
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
      toast.error(t`添加下载任务失败`, { description: String(error) });
    } finally {
      setStarting(false);
    }
  }, [close, destDir, onAdded, probe, selected, source, t]);

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
        {/* Opened from a task row there is nothing to introduce: the header is
            kept for assistive tech only, the torrent name shows right below. */}
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
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
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
                    if (e.key === "Enter" && source.trim()) void doProbe(source);
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
                  <LoaderCircle data-icon="inline-start" className="animate-spin" />
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
                // No header above it here, so leave room for the dialog's
                // floating close button.
                initialSource && "pr-8",
              )}
            >
              <span className="min-w-0 truncate text-sm font-medium">
                {probe.name}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
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
            <DialogFooter className="shrink-0">
              <Button variant="ghost" onClick={close}>
                <Trans>取消</Trans>
              </Button>
              <Button
                disabled={selected.size === 0 || !destDir.trim() || starting}
                onClick={() => void startDownload()}
              >
                {starting ? (
                  <LoaderCircle data-icon="inline-start" className="animate-spin" />
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
