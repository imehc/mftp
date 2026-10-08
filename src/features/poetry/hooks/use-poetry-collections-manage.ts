import { useLingui } from "@lingui/react/macro";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { describeError, toIpcError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import type { AppError, PoetryCollectionStatus } from "~/types";

import { usePoetryStore } from "../store/poetry-store";
import { usePoetrySyncProgress } from "../sync-progress";

/**
 * 桌面与移动的数据管理页共用的合集管理行为：刷新、勾选、开始 / 取消同步、
 * 删除确认。两页只在展示形式（卡片 / 列表、附加索引与翻译包区块）上不同，
 * 选择与同步语义必须一致。
 */
export function usePoetryCollectionsManage() {
  const { t } = useLingui();
  const collections = usePoetryStore((state) => state.collections);
  const setCollections = usePoetryStore((state) => state.setCollections);
  const progress = usePoetrySyncProgress();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const readGeneration = useRef({ value: 0 });
  const mounted = useRef(false);
  const startingRef = useRef(false);
  const [pendingDelete, setPendingDelete] =
    useState<PoetryCollectionStatus | null>(null);

  const refresh = async () => {
    if (!mounted.current) return;
    const generation = ++readGeneration.current.value;
    setLoading(true);
    setError(null);
    try {
      const result = await ipc.poetryCollections();
      if (generation === readGeneration.current.value) setCollections(result);
    } catch (error) {
      if (generation === readGeneration.current.value)
        setError(toIpcError(error).payload);
    } finally {
      if (generation === readGeneration.current.value) setLoading(false);
    }
  };

  const refreshInEffect = useEffectEvent(refresh);
  useEffect(() => {
    const generation = readGeneration.current;
    mounted.current = true;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) void refreshInEffect();
    });
    // 离页使在途读取失效，避免旧列表覆盖新页面或较新的刷新结果。
    return () => {
      disposed = true;
      mounted.current = false;
      generation.value++;
    };
  }, []);

  // 页面只消费共享运行期进度；离页不会停止同步。终态行为由两端共用。
  useEffect(() => {
    if (progress.phase !== "done" && progress.phase !== "error") return;
    if (progress.phase === "done")
      toast.success(t`同步完成`, { id: "poetry-sync" });
    else
      toast.error(t`同步失败`, {
        id: "poetry-sync",
        description: progress.error ? describeError(progress.error) : undefined,
      });
    queueMicrotask(() => void refreshInEffect());
  }, [progress.phase, progress.updatedAt, progress.error, t]);

  const tierOrder = { recommended: 0, default: 1, optIn: 2 };
  const sorted = [...collections].sort(
    (a, b) =>
      tierOrder[a.tier] - tierOrder[b.tier] || a.name.localeCompare(b.name),
  );
  const pending = sorted.filter((collection) => !collection.installed);
  const installed = sorted.filter((collection) => collection.installed);
  // 勾选可能残留已安装的合集 id，取交集后再用于下载与按钮禁用。
  const selectedPendingIds = [...selected].filter((id) =>
    pending.some((collection) => collection.id === id),
  );

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const startSync = async () => {
    if (startingRef.current || progress.active || loading || error) return;
    if (selectedPendingIds.length === 0) {
      toast.info(t`请先选择合集`);
      return;
    }
    startingRef.current = true;
    setStarting(true);
    try {
      await ipc.poetrySyncStart(selectedPendingIds);
    } catch (error) {
      toast.error(t`操作失败`, { description: describeError(error) });
    } finally {
      startingRef.current = false;
      if (mounted.current) setStarting(false);
    }
  };

  const cancelSync = async () => {
    try {
      await ipc.poetrySyncCancel();
    } catch (error) {
      toast.error(t`操作失败`, { description: describeError(error) });
    }
  };

  const confirmDelete = async () => {
    const item = pendingDelete;
    if (!item) return;
    setPendingDelete(null);
    try {
      await ipc.poetryCollectionDelete(item.id);
      const itemName = item.name;
      toast.success(t`已删除 ${itemName}`);
      void refresh();
    } catch (error) {
      toast.error(t`操作失败`, { description: describeError(error) });
    }
  };

  return {
    collections,
    progress,
    loading,
    error,
    refresh,
    pending,
    installed,
    selected,
    selectedPendingIds,
    toggle,
    starting,
    busy: progress.active || starting,
    pendingDelete,
    setPendingDelete,
    startSync,
    cancelSync,
    confirmDelete,
  };
}
