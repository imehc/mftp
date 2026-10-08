import { useLingui } from "@lingui/react/macro";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";

import type { PoetryTranslationPackSummary } from "~/bindings";
import { describeError, toIpcError } from "~/lib/errors";
import { pickFilePathNative } from "~/lib/files";
import {
  poetryAnnotationsDelete,
  poetryAnnotationsInstall,
  poetryAnnotationsStatus,
  poetryContentIndexBuild,
  poetryContentIndexStatus,
  poetrySyncImportLocal,
  poetryTranslationPacks,
} from "~/lib/ipc";
import type { AppError, PoetryContentIndexStatus } from "~/types";

import type { PoetrySyncProgressState } from "../sync-progress";

const INDEX_TOAST_ID = "poetry-index";

/** 桌面本地语料能力独立于页面布局，读取和动作共享忙碌与卸载边界。 */
export function usePoetryLocalData(
  progress: PoetrySyncProgressState,
  selectedPendingIds: string[],
  syncBusy: boolean,
  enabled = true,
) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  const actionPending = useRef(false);
  const [bodyIndex, setBodyIndex] = useState<PoetryContentIndexStatus | null>(
    null,
  );
  const [annotationsCount, setAnnotationsCount] = useState<number | null>(null);
  const [translationPacks, setTranslationPacks] = useState<
    PoetryTranslationPackSummary[]
  >([]);
  const [extrasError, setExtrasError] = useState<AppError | null>(null);
  const [extrasLoading, setExtrasLoading] = useState(true);
  const extraReads = useRef({ generation: 0, mounted: false });

  // 独立读取并行执行；失败保持错误状态，不把未知状态显示成未安装。
  const refreshExtras = async () => {
    if (!extraReads.current.mounted) return;
    const generation = ++extraReads.current.generation;
    setExtrasLoading(true);
    setExtrasError(null);
    try {
      const [index, annotations, packs] = await Promise.all([
        poetryContentIndexStatus(),
        poetryAnnotationsStatus(),
        poetryTranslationPacks(),
      ]);
      if (generation !== extraReads.current.generation) return;
      setBodyIndex(index);
      setAnnotationsCount(annotations.entryCount);
      setTranslationPacks(packs);
    } catch (error) {
      if (generation === extraReads.current.generation)
        setExtrasError(toIpcError(error).payload);
    } finally {
      if (generation === extraReads.current.generation) setExtrasLoading(false);
    }
  };

  const refreshInEffect = useEffectEvent(refreshExtras);
  useEffect(() => {
    if (!enabled) return;
    const reads = extraReads.current;
    reads.mounted = true;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) void refreshExtras();
    });
    return () => {
      disposed = true;
      reads.mounted = false;
      reads.generation++;
    };
  }, [enabled]);

  useEffect(() => {
    if (progress.phase !== "done" && progress.phase !== "error") return;
    queueMicrotask(() => void refreshInEffect());
  }, [progress.phase, progress.updatedAt]);

  const importLocal = async () => {
    if (selectedPendingIds.length === 0) {
      toast.info(t`请先选择合集`);
      return;
    }
    try {
      const picked = await pickFilePathNative({
        filterName: "tar.gz",
        extensions: ["tar.gz", "tgz"],
      });
      if (typeof picked !== "string") return;
      await poetrySyncImportLocal(picked, selectedPendingIds);
    } catch (error) {
      toast.error(t`操作失败`, {
        description: describeError(error),
      });
    }
  };

  const toggleBodyIndex = async (enable: boolean) => {
    try {
      if (enable) {
        toast.loading(t`正在建立正文索引…`, {
          id: INDEX_TOAST_ID,
          duration: Number.POSITIVE_INFINITY,
        });
      }
      await poetryContentIndexBuild(enable);
      setBodyIndex(await poetryContentIndexStatus());
      toast.dismiss(INDEX_TOAST_ID);
      toast.success(t`正文索引已更新`);
    } catch (error) {
      toast.error(t`操作失败`, {
        id: INDEX_TOAST_ID,
        description: describeError(error),
      });
    }
  };

  const installAnnotations = async () => {
    try {
      await poetryAnnotationsInstall();
    } catch (error) {
      toast.error(t`操作失败`, { description: describeError(error) });
    }
  };

  const deleteAnnotations = async () => {
    try {
      await poetryAnnotationsDelete();
      setAnnotationsCount(0);
      toast.success(t`已删除`);
    } catch (error) {
      toast.error(t`操作失败`, {
        description: describeError(error),
      });
    }
  };

  async function runAction(action: () => Promise<void>) {
    if (actionPending.current || syncBusy) return;
    actionPending.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      actionPending.current = false;
      if (extraReads.current.mounted) setBusy(false);
    }
  }

  return {
    bodyIndex,
    annotationsCount,
    translationPacks,
    setTranslationPacks,
    extrasError,
    extrasLoading,
    refreshExtras,
    busy,
    importLocal: () => runAction(importLocal),
    toggleBodyIndex: (enable: boolean) =>
      runAction(() => toggleBodyIndex(enable)),
    installAnnotations: () => runAction(installAnnotations),
    deleteAnnotations: () => runAction(deleteAnnotations),
  };
}
