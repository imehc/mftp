import { infiniteQueryOptions } from "@tanstack/react-query";

import * as ipc from "~/lib/ipc";
import { ipcQuery } from "~/lib/query-client";
import type { PoetrySearchScope } from "~/types";

export const collectionIdsKey = (ids: string[]) => [...new Set(ids)].sort();
export const collectionsQuery = () =>
  ipcQuery(["poetry", "collections"], ipc.poetryCollections);
export const poemQuery = (uid: string) => ({
  ...ipcQuery(["poetry", "poem", uid], () => ipc.poetryPoem(uid)),
  enabled: !!uid.trim(),
});
// 与后端 SystemTime / 86400 一致，按 UTC 日隔离每日一诗。
export const poetryDay = () => Math.floor(Date.now() / 86_400_000);
export const dailyQuery = (day: number) => ({
  ...ipcQuery(["poetry", "daily", day], ipc.poetryDaily),
  staleTime: 86_400_000,
});

export const searchQuery = (
  query: string,
  scope: PoetrySearchScope,
  ids: string[],
) => {
  const collectionIds = collectionIdsKey(ids);
  return {
    ...ipcQuery(["poetry", "search", query, scope, collectionIds], () =>
      ipc.poetrySearch({
        query,
        scope,
        collectionIds: collectionIds.length ? collectionIds : null,
        limit: 60,
        offset: 0,
      }),
    ),
    enabled: !!query.trim(),
    gcTime: 60_000,
  };
};

export function browseQuery(ids: string[]) {
  const collectionIds = collectionIdsKey(ids);
  return infiniteQueryOptions({
    queryKey: ["poetry", "browse", collectionIds],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      ipc.poetryBrowse({
        collectionIds: collectionIds.length ? collectionIds : null,
        author: null,
        cursor: pageParam,
        limit: 60,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    gcTime: 60_000,
  });
}

export const poetryIndexQuery = () =>
  ipcQuery(["poetry", "index"], ipc.poetryContentIndexStatus);
export const annotationsQuery = () =>
  ipcQuery(["poetry", "annotations"], ipc.poetryAnnotationsStatus);
export const translationPacksQuery = () =>
  ipcQuery(["poetry", "translation-packs"], ipc.poetryTranslationPacks);
export const translationsQuery = (uid: string) =>
  ipcQuery(["poetry", "translations", uid], () =>
    ipc.poetryTranslationsList(uid),
  );
export const packTranslationsQuery = (uid: string) =>
  ipcQuery(["poetry", "pack-translations", uid], () =>
    ipc.poetryPackTranslationsList(uid),
  );
export const speechCatalogQuery = () =>
  ipcQuery(["speech", "catalog"], ipc.speechCatalog);
