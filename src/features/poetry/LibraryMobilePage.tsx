import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  CalendarDays,
  Filter,
  LoaderCircle,
  Settings2,
  Shuffle,
} from "lucide-react";
import { toast } from "sonner";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  poetryCollections,
  poetryDaily,
  poetryRandom,
  poetrySearch,
} from "~/lib/ipc";
import type { PoemDetail, PoemSummary } from "~/types";
import PoemCard from "./components/PoemCard";
import PoemList from "./components/PoemList";
import SearchBar from "./components/SearchBar";
import { useDebouncedQuery } from "./hooks/use-poetry-search";
import { usePoetryStore } from "./store/poetry-store";

interface LibraryMobilePageProps {
  search: { q?: string };
  onSearchChange: (patch: { q?: string }) => void;
  onOpenPoem: (uid: string) => void;
}

export default function LibraryMobilePage({
  search,
  onSearchChange,
  onOpenPoem,
}: LibraryMobilePageProps) {
  const { t } = useLingui();
  const collections = usePoetryStore((state) => state.collections);
  const setCollections = usePoetryStore((state) => state.setCollections);
  const activeCollectionIds = usePoetryStore(
    (state) => state.activeCollectionIds,
  );
  const toggleCollection = usePoetryStore((state) => state.toggleCollection);
  const clearCollectionFilter = usePoetryStore(
    (state) => state.clearCollectionFilter,
  );
  const scope = usePoetryStore((state) => state.searchScope);
  const setScope = usePoetryStore((state) => state.setSearchScope);
  const history = usePoetryStore((state) => state.searchHistory);
  const pushHistory = usePoetryStore((state) => state.pushSearchHistory);
  const removeHistory = usePoetryStore((state) => state.removeSearchHistory);
  const clearHistory = usePoetryStore((state) => state.clearSearchHistory);
  const { input, setInput, query } = useDebouncedQuery(300);
  const skipUrlSync = useRef(false);
  const [daily, setDaily] = useState<PoemDetail | null>(null);
  const [results, setResults] = useState<PoemSummary[] | null>(null);
  const [searching, setSearching] = useState(false);

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

  useEffect(() => {
    pushQueryToUrl();
  }, [query]);

  useEffect(() => {
    void poetryCollections()
      .then(setCollections)
      .catch((error) =>
        toast.error(t`读取失败`, { description: String(error) }),
      );
  }, [setCollections, t]);

  const installedCount = collections.filter(
    (collection) => collection.installed,
  ).length;
  useEffect(() => {
    if (installedCount === 0) return;
    void poetryDaily()
      .then(setDaily)
      .catch(() => setDaily(null));
  }, [installedCount]);

  const isSearching = query.trim().length > 0;
  useEffect(() => {
    if (!isSearching) {
      queueMicrotask(() => setResults(null));
      return;
    }
    let cancelled = false;
    queueMicrotask(() => setSearching(true));
    void poetrySearch({
      query,
      scope,
      collectionIds: activeCollectionIds.length ? activeCollectionIds : null,
      limit: 60,
      offset: 0,
    })
      .then((result) => {
        if (!cancelled) setResults(result.items);
      })
      .catch((error) => {
        if (!cancelled) {
          setResults([]);
          toast.error(t`操作失败`, { description: String(error) });
        }
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCollectionIds, isSearching, query, scope, t]);

  const handleRandom = async () => {
    try {
      const poem = await poetryRandom();
      if (poem) onOpenPoem(poem.uid);
    } catch (error) {
      toast.error(t`操作失败`, { description: String(error) });
    }
  };

  const loadedOnce = collections.length > 0;
  if (loadedOnce && installedCount === 0) {
    return (
      <main className="bg-background text-foreground flex h-full flex-col">
        <ToolPageHeader title={<Trans>古诗词</Trans>} />
        <Empty className="flex-1 px-5">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarDays />
            </EmptyMedia>
            <EmptyTitle>
              <Trans>古诗词语料还没有下载</Trans>
            </EmptyTitle>
            <EmptyDescription>
              <Trans>下载精选合集后即可在此离线阅读。</Trans>
            </EmptyDescription>
            <Button asChild>
              <Link to="/library/manage">
                <Settings2 data-icon="inline-start" />
                <Trans>获取诗词数据</Trans>
              </Link>
            </Button>
          </EmptyHeader>
        </Empty>
      </main>
    );
  }

  return (
    <main className="bg-background text-foreground flex h-full flex-col">
      <ToolPageHeader
        title={<Trans>古诗词</Trans>}
        trailing={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void handleRandom()}
            aria-label={t`随机`}
            title={t`随机`}
          >
            <Shuffle />
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <SearchBar
          input={input}
          scope={scope}
          history={history}
          filterSlot={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={t`按合集筛选`}
                  title={t`按合集筛选`}
                >
                  <Filter />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-72 overflow-y-auto"
              >
                <DropdownMenuItem
                  disabled={activeCollectionIds.length === 0}
                  onSelect={() => clearCollectionFilter()}
                >
                  <Trans>全部</Trans>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {collections
                  .filter((collection) => collection.installed)
                  .map((collection) => (
                    <DropdownMenuCheckboxItem
                      key={collection.id}
                      checked={activeCollectionIds.includes(collection.id)}
                      onCheckedChange={() => toggleCollection(collection.id)}
                      onSelect={(event) => event.preventDefault()}
                    >
                      {collection.name}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          }
          onInputChange={setInput}
          onScopeChange={setScope}
          onSubmit={(value) => {
            pushHistory(value);
            skipUrlSync.current = false;
            setInput(value);
          }}
          onRemoveHistory={removeHistory}
          onClearHistory={clearHistory}
        />
        <div className="min-h-0 flex-1">
          {isSearching && searching && results === null ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-xs">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              <Trans>正在检索…</Trans>
            </div>
          ) : isSearching ? (
            results && results.length > 0 ? (
              <div className="h-full overflow-y-auto px-3 pb-4" role="list">
                {results.map((poem) => (
                  <div key={poem.uid} role="listitem" className="pb-2">
                    <PoemCard
                      poem={poem}
                      query={query}
                      active={false}
                      onSelect={onOpenPoem}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground py-10 text-center text-sm">
                <Trans>没有找到作品</Trans>
              </p>
            )
          ) : (
            <>
              {!activeCollectionIds.length && daily ? (
                <button
                  type="button"
                  onClick={() => onOpenPoem(daily.uid)}
                  className="border-primary/30 bg-primary/5 hover:bg-primary/10 mx-3 mb-2 flex w-[calc(100%-1.5rem)] flex-col rounded-lg border px-3 py-2.5 text-left"
                >
                  <span className="text-primary flex items-center gap-1.5 text-xs font-medium">
                    <CalendarDays className="size-3.5" aria-hidden />
                    <Trans>每日一诗</Trans>
                  </span>
                  <span className="mt-1 truncate text-sm font-medium">
                    {daily.title}
                  </span>
                  <span className="text-muted-foreground mt-0.5 truncate text-xs">
                    {[daily.author, daily.dynasty].filter(Boolean).join("·")}
                  </span>
                </button>
              ) : null}
              <PoemList
                resetKey={`mobile:${activeCollectionIds.join(",")}`}
                collectionIds={activeCollectionIds}
                onSelect={onOpenPoem}
                scrollStorageKey="mftp-poetry-mobile-scroll"
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
