import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { describeError, toIpcError } from "~/lib/errors";
import { pickFilePathNative } from "~/lib/files";
import {
  poetryAnnotationsDelete,
  poetryAnnotationsInstall,
  poetryContentIndexBuild,
  poetrySyncImportLocal,
} from "~/lib/ipc";
import { refreshQueries } from "~/lib/query-invalidation";

import {
  annotationsQuery,
  poetryIndexQuery,
  translationPacksQuery,
} from "../queries";

const INDEX_TOAST_ID = "poetry-index";

/** 桌面本地语料能力独立于页面布局，读取和动作共享忙碌与卸载边界。 */
export function usePoetryLocalData(
  selectedPendingIds: string[],
  syncBusy: boolean,
  enabled = true,
) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  const actionPending = useRef(false);
  const client = useQueryClient();
  const indexRead = useQuery({ ...poetryIndexQuery(), enabled });
  const annotationsRead = useQuery({ ...annotationsQuery(), enabled });
  const packsRead = useQuery({ ...translationPacksQuery(), enabled });
  const bodyIndex = indexRead.data ?? null;
  const annotationsCount = annotationsRead.data?.entryCount ?? null;
  const translationPacks = packsRead.data ?? [];
  const error = indexRead.error ?? annotationsRead.error ?? packsRead.error;
  const extrasError = error ? toIpcError(error).payload : null;
  const extrasLoading =
    indexRead.isLoading || annotationsRead.isLoading || packsRead.isLoading;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = enabled;
    return () => {
      mounted.current = false;
    };
  }, [enabled]);

  const refreshExtras = () => {
    if (!enabled) return;
    void indexRead.refetch({ cancelRefetch: false });
    void annotationsRead.refetch({ cancelRefetch: false });
    void packsRead.refetch({ cancelRefetch: false });
  };

  const changed = () => {
    void refreshQueries(client, { queryKey: ["poetry"] });
  };

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
        description: describeError(error, t),
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
      changed();
      toast.dismiss(INDEX_TOAST_ID);
      toast.success(t`正文索引已更新`);
    } catch (error) {
      toast.error(t`操作失败`, {
        id: INDEX_TOAST_ID,
        description: describeError(error, t),
      });
    }
  };

  const installAnnotations = async () => {
    try {
      await poetryAnnotationsInstall();
      changed();
    } catch (error) {
      toast.error(t`操作失败`, { description: describeError(error, t) });
    }
  };

  const deleteAnnotations = async () => {
    try {
      await poetryAnnotationsDelete();
      changed();
      toast.success(t`已删除`);
    } catch (error) {
      toast.error(t`操作失败`, {
        description: describeError(error, t),
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
      if (mounted.current) setBusy(false);
    }
  }

  return {
    bodyIndex,
    annotationsCount,
    translationPacks,
    onPacksChange: changed,
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
