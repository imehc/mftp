import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { describeError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";

import {
  collectionsQuery,
  dailyQuery,
  poetryDay,
  searchQuery,
} from "../queries";
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
  const collectionRead = useQuery(collectionsQuery());
  const collections = collectionRead.data ?? [];
  const activeCollectionIds = usePoetryStore((s) => s.activeCollectionIds);
  const scope = usePoetryStore((s) => s.searchScope);
  const pushHistory = usePoetryStore((s) => s.pushSearchHistory);
  const { input, setInput, query } = useDebouncedQuery(300, search.q ?? "");
  const {
    detail,
    loading: detailLoading,
    error: detailError,
    retry: retryDetail,
  } = usePoemRead(search.poem);
  const installedCount = collections.filter((item) => item.installed).length;
  const [day, setDay] = useState(poetryDay);
  useEffect(() => {
    const update = () => setDay(poetryDay());
    const timer = setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const dailyRead = useQuery({
    ...dailyQuery(day),
    enabled: installedCount > 0,
  });
  const searchRead = useQuery(searchQuery(query, scope, activeCollectionIds));
  const isSearching = !!query.trim();
  const results = isSearching ? (searchRead.data?.items ?? null) : null;
  const searching = isSearching && searchRead.isFetching;
  const daily = installedCount > 0 ? (dailyRead.data ?? null) : null;
  const collectionsError = collectionRead.error?.payload ?? null;
  const collectionsLoading = collectionRead.isPending;
  const loadedOnce = collectionRead.data !== undefined;
  const searchError = searchRead.error?.payload ?? null;

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
        description: describeError(error, t),
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
    retryCollections: () => {
      void collectionRead.refetch({ cancelRefetch: false });
    },
    searchError,
    retrySearch: () => {
      if (isSearching) void searchRead.refetch({ cancelRefetch: false });
    },
    detailError,
    retryDetail,
    handleSelect,
    handleSubmit,
    handleRandom,
  };
}
