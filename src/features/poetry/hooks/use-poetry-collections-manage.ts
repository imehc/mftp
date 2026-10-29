import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { describeError, hasCustomCode } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import { invalidateData } from "~/lib/query-client";
import type { PoetryCollectionStatus } from "~/types";

import { collectionsQuery } from "../queries";
import { usePoetrySyncProgress } from "../sync-progress";

/**
 * 桌面与移动的数据管理页共用的合集管理行为：刷新、勾选、开始 / 取消同步、
 * 删除确认。两页只在展示形式（卡片 / 列表、附加索引与翻译包区块）上不同，
 * 选择与同步语义必须一致。
 */
export function usePoetryCollectionsManage() {
  const { t } = useLingui();
  const query = useQuery(collectionsQuery());
  const collections = query.data ?? [];
  const loading = query.isPending;
  const error = query.error?.payload ?? null;

  const refresh = () => {
    void query.refetch({ cancelRefetch: false });
  };

  const progress = usePoetrySyncProgress();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const mounted = useRef(false);
  const startingRef = useRef(false);
  const [pendingDelete, setPendingDelete] =
    useState<PoetryCollectionStatus | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 页面只消费共享运行期进度；离页不会停止同步。终态行为由两端共用。
  // 挂载时已存在的终态属于上一次任务：只播报本次挂载期间新到达的终态，否则
  // 每次进入页面都会重播一遍旧的「同步失败」。
  const handledTerminalAt = useRef(progress.updatedAt);
  useEffect(() => {
    if (progress.phase !== "done" && progress.phase !== "error") return;
    if (progress.updatedAt <= handledTerminalAt.current) return;
    handledTerminalAt.current = progress.updatedAt;
    if (progress.phase === "done")
      toast.success(t`同步完成`, { id: "poetry-sync" });
    // 主动取消不是失败：按信息提示处理，避免底部出现红色「同步失败」。
    else if (hasCustomCode(progress.error, "poetry:sync_cancelled"))
      toast.info(t`已取消同步`, { id: "poetry-sync" });
    else
      toast.error(t`同步失败`, {
        id: "poetry-sync",
        description: progress.error
          ? describeError(progress.error, t)
          : undefined,
      });
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
      toast.error(t`操作失败`, { description: describeError(error, t) });
    } finally {
      startingRef.current = false;
      if (mounted.current) setStarting(false);
    }
  };

  const cancelSync = async () => {
    try {
      await ipc.poetrySyncCancel();
    } catch (error) {
      toast.error(t`操作失败`, { description: describeError(error, t) });
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
      void invalidateData(["poetry"]);
    } catch (error) {
      toast.error(t`操作失败`, { description: describeError(error, t) });
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
