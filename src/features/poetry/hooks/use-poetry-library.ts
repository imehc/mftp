import { useLingui } from "@lingui/react/macro";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { describeError, toIpcError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";
import type { AppError, PoemDetail, PoemSummary } from "~/types";

import { usePoetryStore } from "../store/poetry-store";
import { usePoemRead } from "./use-poem-read";
import { useDebouncedQuery } from "./use-poetry-search";

interface UsePoetryLibraryOptions {
  /** 路由上的查询参数（唯一来源），页面间共享同一套链接语义。 */
  search: { q?: string; poem?: string };
  onSearchChange: (patch: { q?: string }) => void;
  onOpenPoem: (uid: string) => void;
}

/**
 * 桌面双栏与移动单栏共用的诗词库行为：合集缓存、防抖搜索、每日一诗与
 * 详情读取。两页只在布局与阅读偏好上不同，查询 / URL 镜像、读取代次
 * 与错误提示必须完全一致，避免两端行为漂移。
 */
export function usePoetryLibrary({
  search,
  onSearchChange,
  onOpenPoem,
}: UsePoetryLibraryOptions) {
  const { t } = useLingui();
  const collections = usePoetryStore((s) => s.collections);
  const setCollections = usePoetryStore((s) => s.setCollections);
  const activeCollectionIds = usePoetryStore((s) => s.activeCollectionIds);
  const scope = usePoetryStore((s) => s.searchScope);
  const pushHistory = usePoetryStore((s) => s.pushSearchHistory);
  const { input, setInput, query } = useDebouncedQuery(300, search.q ?? "");
  const [results, setResults] = useState<PoemSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [daily, setDaily] = useState<PoemDetail | null>(null);
  const {
    detail,
    loading: detailLoading,
    error: detailError,
    retry: retryDetail,
  } = usePoemRead(search.poem);
  const [collectionsError, setCollectionsError] = useState<AppError | null>(
    null,
  );
  const [collectionsRevision, setCollectionsRevision] = useState(0);
  const [collectionsLoading, setCollectionsLoading] = useState(true);
  const [collectionsLoaded, setCollectionsLoaded] = useState(false);
  const [searchError, setSearchError] = useState<AppError | null>(null);
  const [searchRevision, setSearchRevision] = useState(0);

  // URL 与本地的查询双向镜像；skip 标志防止自己的导航回写覆盖正在输入的内容。
  const skipUrlSync = useRef(false);
  const syncInputFromUrl = useEffectEvent((value: string) => setInput(value));
  const pushQueryToUrl = useEffectEvent(() => {
    const next = query || undefined;
    if ((search.q ?? undefined) === next) return;
    skipUrlSync.current = true;
    onSearchChange({ q: next });
  });

  useEffect(() => {
    if (skipUrlSync.current) {
      skipUrlSync.current = false;
      return;
    }
    syncInputFromUrl(search.q ?? "");
  }, [search.q]);

  // 把稳定后的查询写入 URL（替换式），便于返回 / 分享。
  useEffect(() => {
    pushQueryToUrl();
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setCollectionsLoading(true);
        setCollectionsError(null);
      }
    });
    void ipc
      .poetryCollections()
      .then((result) => {
        if (!cancelled) {
          setCollections(result);
          setCollectionsLoaded(true);
        }
      })
      .catch((error) => {
        if (!cancelled) setCollectionsError(toIpcError(error).payload);
      })
      .finally(() => {
        if (!cancelled) setCollectionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setCollections, collectionsRevision]);

  const installedCount = collections.filter(
    (collection) => collection.installed,
  ).length;
  const loadedOnce =
    collectionsLoaded && !collectionsError && !collectionsLoading;

  useEffect(() => {
    let cancelled = false;
    if (installedCount > 0)
      void ipc
        .poetryDaily()
        .then((poem) => {
          if (!cancelled) setDaily(poem);
        })
        .catch(() => {
          if (!cancelled) setDaily(null);
        });
    return () => {
      cancelled = true;
    };
  }, [installedCount]);

  const isSearching = query.trim().length > 0;
  // 防抖后的搜索流程。状态更新被延后，使其在 effect 函数体之外发生。
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setResults(null);
        setSearchError(null);
        setSearching(isSearching);
      }
    });
    if (!isSearching)
      return () => {
        cancelled = true;
      };
    void ipc
      .poetrySearch({
        query,
        scope,
        collectionIds:
          activeCollectionIds.length > 0 ? activeCollectionIds : null,
        limit: 60,
        offset: 0,
      })
      .then((result) => {
        if (!cancelled) setResults(result.items);
      })
      .catch((error) => {
        if (!cancelled) {
          setResults(null);
          setSearchError(toIpcError(error).payload);
        }
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCollectionIds, isSearching, query, scope, searchRevision]);

  const handleSelect = (uid: string) => onOpenPoem(uid);

  /** 用户主动提交查询：记入历史并立刻采用输入值。 */
  const handleSubmit = (value: string) => {
    pushHistory(value);
    // 提交是用户意图，接下来的 URL 回写不应该被输入镜像保护挡掉。
    skipUrlSync.current = false;
    setInput(value);
  };

  const handleRandom = async (select: (uid: string) => void) => {
    try {
      const poem = await ipc.poetryRandom();
      if (poem) select(poem.uid);
    } catch (error) {
      toast.error(t`操作失败`, {
        description: describeError(error),
      });
    }
  };

  return {
    collections,
    activeCollectionIds,
    scope,
    input,
    setInput,
    query,
    isSearching,
    results,
    searching,
    daily,
    detail,
    detailLoading,
    installedCount,
    loadedOnce,
    collectionsError,
    collectionsLoading,
    retryCollections: () => setCollectionsRevision((value) => value + 1),
    searchError,
    retrySearch: () => setSearchRevision((value) => value + 1),
    detailError,
    retryDetail,
    handleSelect,
    handleSubmit,
    handleRandom,
  };
}
