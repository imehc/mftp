import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { FolderOpen, LoaderCircle, Magnet } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import type { BtProbeResult, BtTaskInfo } from "~/types";
import * as ipc from "~/lib/ipc";
import { formatBytes } from "~/lib/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import { DialogLayoutHeader } from "~/components/ui/dialog-layout";
import TorrentFileList from "./TorrentFileList";
import { describeError } from "~/lib/errors";
export interface AddTorrentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (
    task: BtTaskInfo,
    source: string,
    probe: BtProbeResult,
    fileIndices: number[],
  ) => void;
  /** 预填的来源和首次解析结果，用于从任务列表直接打开文件选择。 */
  initialSource?: string | null;
  initialProbe?: BtProbeResult | null;
  initialSelected?: number[] | null;
  readOnly?: boolean;
  existingInfoHashes: ReadonlySet<string>;
  allowExistingTask?: boolean;
}

/**
 * 添加流程：磁力链接 / .torrent 输入 → bt_probe 文件树 → 选择 →
 * 文件选择 → bt_add_download。任务进入下载列表和底部传输面板。
 *
 * 已添加任务从 BT 页面标题打开时直接复用首次解析结果，不再次调用
 * bt_probe；只有错误任务的显式“重试”动作才重新探测磁力链接。
 */
export default function AddTorrentDialog({
  open,
  onOpenChange,
  onAdded,
  initialSource,
  initialProbe,
  initialSelected,
  readOnly = false,
  existingInfoHashes,
  allowExistingTask = false,
}: AddTorrentDialogProps) {
  const { t } = useLingui();
  const requests = useRef({ generation: 0, probing: false, starting: false });
  useEffect(() => {
    const state = requests.current;
    return () => {
      state.generation++;
    };
  }, []);
  const [source, setSource] = useState("");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<BtProbeResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [starting, setStarting] = useState(false);
  // 仅在带 initialSource 时有意义：失败时回到输入步骤，
  // 这样磁力链接可被重新解析，而不是一直转圈。
  const [probeFailed, setProbeFailed] = useState(false);
  const reset = () => {
    setSource("");
    setProbing(false);
    setProbe(null);
    setSelected(new Set());
    setStarting(false);
    setProbeFailed(false);
  };
  const close = () => {
    if (requests.current.starting) return;
    requests.current.generation++;
    requests.current.probing = false;
    onOpenChange(false);
  };
  const doProbe = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || requests.current.probing || requests.current.starting)
      return;
    requests.current.probing = true;
    const generation = ++requests.current.generation;
    const apply = (result: BtProbeResult) => {
      setProbe(result);
      // 默认全选所有文件。
      setSelected(new Set(result.files.map((f) => f.index)));
    };
    setProbeFailed(false);
    setProbing(true);
    try {
      const result = await ipc.btProbe(trimmed);
      if (generation === requests.current.generation) apply(result);
    } catch (error) {
      if (generation !== requests.current.generation) return;
      setProbeFailed(true);
      toast.error(t`获取资源信息失败`, {
        description: describeError(error),
      });
    } finally {
      if (generation === requests.current.generation) {
        requests.current.probing = false;
        setProbing(false);
      }
    }
  };
  const pickTorrent = async () => {
    const generation = requests.current.generation;
    try {
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
      if (generation !== requests.current.generation) return;
      if (typeof picked === "string") {
        setSource(picked);
        await doProbe(picked);
      }
    } catch (error) {
      if (generation === requests.current.generation)
        toast.error(t`获取资源信息失败`, { description: describeError(error) });
    }
  };

  // 从任务行打开：完全跳过输入步骤，直接注入首次解析结果。
  // source 是普通字符串，在 BT 页轮询重渲染时保持稳定。
  const doProbeOnOpen = useEffectEvent(doProbe);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    // 用微任务延后，使重置发生在 effect 函数体之外。
    queueMicrotask(() => {
      if (disposed) return;
      reset();
      requests.current.probing = false;
      if (!initialSource) return;
      setProbe(null);
      setSource(initialSource);
      if (initialProbe) {
        setProbe(initialProbe);
        setSelected(
          new Set(
            initialSelected ?? initialProbe.files.map((file) => file.index),
          ),
        );
        return;
      }
      // 没有首次解析结果时才允许走普通探测路径。
      void doProbeOnOpen(initialSource);
    });
    const state = requests.current;
    return () => {
      disposed = true;
      state.generation++;
    };
  }, [initialProbe, initialSelected, initialSource, open]);
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
  const selectedBytes = (() => {
    if (!probe) return 0;
    return probe.files
      .filter((f) => selected.has(f.index))
      .reduce((sum, f) => sum + f.len, 0);
  })();
  const duplicateTask =
    !!probe &&
    !readOnly &&
    !allowExistingTask &&
    existingInfoHashes.has(probe.infoHash);
  const startDownload = async () => {
    if (
      !probe ||
      selected.size === 0 ||
      duplicateTask ||
      requests.current.starting
    )
      return;
    requests.current.starting = true;
    const generation = requests.current.generation;
    setStarting(true);
    try {
      const fileIndices = [...selected].sort((a, b) => a - b);
      const task = await ipc.btAddDownload(
        source.trim(),
        probe.infoHash,
        fileIndices,
      );
      if (generation !== requests.current.generation) return;
      onAdded(task, source.trim(), probe, fileIndices);
      toast.success(t`任务已添加，可在传输面板查看进度`);
      requests.current.starting = false;
      close();
    } catch (error) {
      toast.error(t`添加下载任务失败`, {
        description: describeError(error),
      });
    } finally {
      requests.current.starting = false;
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
        placement="responsive-page"
        showCloseButton={false}
        className="ui-density-adaptive flex max-h-full min-h-0 flex-col overflow-hidden md:max-w-[30rem]"
      >
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            {readOnly ? <Trans>查看资源信息</Trans> : <Trans>添加下载</Trans>}
          </DialogTitle>
          <DialogDescription className="sr-only">
            <Trans>支持磁力链接与本地 .torrent 文件</Trans>
          </DialogDescription>
        </DialogLayoutHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {!readOnly ? (
            <div className="flex flex-col gap-3">
              <Label htmlFor="bt-source">
                <Trans>磁力链接</Trans>
              </Label>
              <Textarea
                id="bt-source"
                rows={3}
                value={source}
                disabled={probing || starting}
                onChange={(event) => {
                  setSource(event.target.value);
                  setProbe(null);
                }}
                placeholder={t`磁力链接`}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  fullWidth
                  disabled={probing || starting}
                  onClick={() => void pickTorrent()}
                >
                  <FolderOpen data-icon="inline-start" />
                  <Trans>选择种子文件</Trans>
                </Button>
                {!probe ? (
                  <Button
                    fullWidth
                    disabled={!source.trim() || probing || starting}
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
                    <Trans>解析</Trans>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {probing ? (
            <p role="status" className="text-muted-foreground text-sm">
              <Trans>正在获取资源信息…</Trans>
            </p>
          ) : null}
          {probeFailed ? (
            <p role="alert" className="text-destructive text-sm">
              <Trans>获取资源信息失败</Trans>
            </p>
          ) : null}
          {probe ? (
            <section className="flex min-h-48 shrink-0 flex-col gap-3 rounded-xl border p-3">
              <h2 className="text-sm font-semibold">
                <Trans>解析结果</Trans>
              </h2>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0 text-sm font-medium break-words">
                  {probe.name}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatBytes(selectedBytes)} / {formatBytes(probe.totalLen)}
                </span>
              </div>
              <div
                className="min-h-0"
                style={{
                  height: `${Math.min(probe.files.length, 6) * 2.75 + 2.5}rem`,
                }}
              >
                <TorrentFileList
                  files={probe.files}
                  selected={selected}
                  onToggle={toggleFile}
                  readOnly={readOnly || starting}
                />
              </div>
            </section>
          ) : null}
          {probe && !readOnly ? (
            <p className="text-muted-foreground text-xs">
              <Trans>下载完成后可复制到系统下载目录或其他位置</Trans>
            </p>
          ) : null}
          {duplicateTask ? (
            <p role="alert" className="text-destructive text-xs">
              <Trans>该资源已在下载列表中，不能重复添加</Trans>
            </p>
          ) : null}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" disabled={starting} onClick={close}>
            {readOnly ? <Trans>关闭</Trans> : <Trans>取消</Trans>}
          </Button>
          {!readOnly ? (
            <Button
              disabled={
                !probe || selected.size === 0 || starting || duplicateTask
              }
              onClick={() => void startDownload()}
            >
              {starting ? (
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : null}
              <Trans>开始下载</Trans>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
