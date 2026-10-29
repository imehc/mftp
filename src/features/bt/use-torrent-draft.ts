import { useLingui } from "@lingui/react/macro";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { describeError, toIpcError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import type { AppError, BtProbeResult, BtTaskInfo } from "~/types";

export interface TorrentDraftOptions {
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

export function useTorrentDraft({
  open,
  onOpenChange,
  onAdded,
  initialSource,
  initialProbe,
  initialSelected,
  readOnly = false,
  existingInfoHashes,
  allowExistingTask = false,
}: TorrentDraftOptions) {
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
  const [probeError, setProbeError] = useState<AppError | null>(null);

  const reset = () => {
    setSource("");
    setProbing(false);
    setProbe(null);
    setSelected(new Set());
    setStarting(false);
    setProbeError(null);
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

    setProbeError(null);
    setProbing(true);
    try {
      const result = await ipc.btProbe(trimmed);
      if (generation === requests.current.generation) {
        setProbe(result);
        setSelected(new Set(result.files.map((file) => file.index)));
      }
    } catch (error) {
      if (generation !== requests.current.generation) return;
      // 解析失败属于当前输入框的问题，只保留就近的内联错误并带上原因。
      setProbeError(toIpcError(error).payload);
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
        toast.error(t`获取资源信息失败`, {
          description: describeError(error, t),
        });
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
        description: describeError(error, t),
      });
    } finally {
      requests.current.starting = false;
      setStarting(false);
    }
  };

  const changeSource = (value: string) => {
    setSource(value);
    setProbe(null);
    setProbeError(null);
  };

  return {
    source,
    changeSource,
    probing,
    probe,
    selected,
    starting,
    probeError,
    close,
    doProbe,
    pickTorrent,
    toggleFile,
    selectedBytes,
    duplicateTask,
    startDownload,
  };
}
