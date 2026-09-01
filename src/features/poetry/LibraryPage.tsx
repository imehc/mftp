import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  BookMarked,
  CalendarDays,
  Filter,
  LoaderCircle,
  Shuffle,
  SlidersHorizontal,
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
  poetryPoem,
  poetryRandom,
  poetrySearch,
} from "~/lib/ipc";
import type { PoemDetail, PoemSummary } from "~/types";
import PoemCard from "./components/PoemCard";
import PoemDetailPane from "./components/PoemDetail";
import PoemList from "./components/PoemList";
import SearchBar from "./components/SearchBar";
import { useDebouncedQuery } from "./hooks/use-poetry-search";
import { usePoetryStore } from "./store/poetry-store";
interface LibraryPageProps {
  search: {
    q?: string;
    poem?: string;
  };
  onSearchChange: (patch: { q?: string }) => void;
  onOpenPoem: (uid: string) => void;
}
function DailyCard({
  daily,
  onSelect,
}: {
  daily: PoemDetail | null;
  onSelect: (uid: string) => void;
}) {
  if (!daily) return null;
  return (
    <button
      type="button"
      onClick={() => onSelect(daily.uid)}
      className="border-primary/30 bg-primary/5 hover:bg-primary/10 mx-3 mb-2 rounded-lg border px-3 py-2.5 text-left transition-colors"
    >
      <span className="text-primary flex items-center gap-1.5 text-[11px] font-medium">
        <CalendarDays className="size-3" aria-hidden />
        <Trans>每日一诗</Trans>
      </span>
      <span className="mt-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">{daily.title}</span>
        <span className="text-muted-foreground shrink-0 text-xs">
          {[daily.author, daily.dynasty].filter(Boolean).join("·")}
        </span>
      </span>
      <span className="text-muted-foreground mt-0.5 line-clamp-1 block text-xs">
        {daily.body[0]}
      </span>
    </button>
  );
}

/** 有界搜索结果列表——单页最多约 60 条命中，不做虚拟化。 */
function SearchResultList({
  items,
  query,
  selectedUid,
  onSelect,
}: {
  items: PoemSummary[];
  query: string;
  selectedUid?: string;
  onSelect: (uid: string) => void;
}) {
  return (
    <div className="h-full overflow-y-auto px-2 pb-4" role="list">
      {items.map((poem) => (
        <div key={poem.uid} role="listitem" className="pb-2">
          <PoemCard
            poem={poem}
            query={query}
            active={poem.uid === selectedUid}
            onSelect={onSelect}
          />
        </div>
      ))}
    </div>
  );
}
export default function LibraryPage({
  search,
  onSearchChange,
  onOpenPoem,
}: LibraryPageProps) {
  const { t } = useLingui();
  const collections = usePoetryStore((s) => s.collections);
  const setCollections = usePoetryStore((s) => s.setCollections);
  const activeCollectionIds = usePoetryStore((s) => s.activeCollectionIds);
  const toggleCollection = usePoetryStore((s) => s.toggleCollection);
  const clearCollectionFilter = usePoetryStore((s) => s.clearCollectionFilter);
  const scope = usePoetryStore((s) => s.searchScope);
  const setScope = usePoetryStore((s) => s.setSearchScope);
  const history = usePoetryStore((s) => s.searchHistory);
  const pushHistory = usePoetryStore((s) => s.pushSearchHistory);
  const fontSize = usePoetryStore((s) => s.fontSize);
  const lineHeight = usePoetryStore((s) => s.lineHeight);
  const setFontSize = usePoetryStore((s) => s.setFontSize);
  const setLineHeight = usePoetryStore((s) => s.setLineHeight);

  // 稳定（防抖后）的查询驱动 IPC；URL 与之镜像。skip 标志用于
  // 防止我们自己的导航回写 URL 把正在输入的内容覆盖掉。
  const skipUrlSync = useRef(false);
  const { input, setInput, query } = useDebouncedQuery(300);
  // setInput/onSearchChange 是自定义 hook / 属性回调；通过 effect event
  // 读取，使这些 effect 只依赖真正的触发条件。
  const syncInputFromUrl = useEffectEvent((value: string) => setInput(value));
  const pushQueryToUrl = useEffectEvent(() => {
    const next = query || undefined;
    if ((search.q ?? undefined) === next) return;
    skipUrlSync.current = true;
    onSearchChange({
      q: next,
    });
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
  const effectiveQuery = query;
  const isSearching = effectiveQuery.trim().length > 0;
  const [results, setResults] = useState<PoemSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [daily, setDaily] = useState<PoemDetail | null>(null);
  const [detail, setDetail] = useState<PoemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const installedCount = collections.filter(
    (collection) => collection.installed,
  ).length;
  const loadedOnce = collections.length > 0;
  useEffect(() => {
    void poetryCollections()
      .then(setCollections)
      .catch((error) =>
        toast.error(t`读取失败`, {
          description: String(error),
        }),
      );
  }, [setCollections, t]);
  useEffect(() => {
    if (installedCount === 0) return;
    void poetryDaily()
      .then(setDaily)
      .catch(() => setDaily(null));
  }, [installedCount]);

  // 防抖后的搜索流程。状态更新被延后，使其在 effect 函数体之外发生。
  useEffect(() => {
    if (!isSearching) {
      queueMicrotask(() => setResults(null));
      return;
    }
    let cancelled = false;
    queueMicrotask(() => setSearching(true));
    void poetrySearch({
      query: effectiveQuery,
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
          setResults([]);
          toast.error(t`操作失败`, {
            description: String(error),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveQuery, scope, activeCollectionIds, isSearching, t]);
  const loadDetail = (uid: string) => {
    setDetailLoading(true);
    void poetryPoem(uid)
      .then(setDetail)
      .catch((error) =>
        toast.error(t`操作失败`, {
          description: String(error),
        }),
      )
      .finally(() => setDetailLoading(false));
  };
  const loadDetailIfNeeded = useEffectEvent((uid: string) => {
    if (detail?.uid !== uid) loadDetail(uid);
  });
  useEffect(() => {
    const uid = search.poem;
    if (!uid) return;
    // 用微任务延后，使同步加载状态的更新发生在 effect 之外。
    queueMicrotask(() => loadDetailIfNeeded(uid));
  }, [search.poem]);
  const handleSelect = (uid: string) => {
    onOpenPoem(uid);
    loadDetail(uid);
  };
  const handleRandom = async () => {
    try {
      const poem = await poetryRandom();
      if (poem) handleSelect(poem.uid);
    } catch (error) {
      toast.error(t`操作失败`, {
        description: String(error),
      });
    }
  };
  const manageLink = (
    <Button variant="ghost" size="xs" asChild>
      <Link to="/library/manage">
        <SlidersHorizontal data-icon="inline-start" />
        <Trans>数据管理</Trans>
      </Link>
    </Button>
  );
  if (loadedOnce && installedCount === 0) {
    return (
      <main className="bg-background text-foreground flex h-full flex-col">
        <ToolPageHeader title={<Trans>古诗词</Trans>} trailing={manageLink} />
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookMarked />
            </EmptyMedia>
            <EmptyTitle>
              <Trans>古诗词语料还没有下载</Trans>
            </EmptyTitle>
            <EmptyDescription>
              <Trans>在数据管理页勾选合集并下载，即可离线浏览。</Trans>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </main>
    );
  }
  const activeCollectionIdsLength = activeCollectionIds.length;
  return (
    <main className="bg-background text-foreground flex h-full flex-col">
      <ToolPageHeader
        title={<Trans>文库</Trans>}
        trailing={
          <>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void handleRandom()}
              aria-label={t`随机`}
            >
              <Shuffle data-icon="inline-start" />
              <Trans>随机</Trans>
            </Button>
            {manageLink}
          </>
        }
      />
      <Group
        orientation="horizontal"
        className="min-h-0 flex-1 overflow-hidden"
      >
        <Panel id="library-list" defaultSize="34" minSize="20">
          <div className="flex h-full flex-col">
            <SearchBar
              input={input}
              scope={scope}
              history={history}
              filterSlot={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      aria-label={t`按合集筛选`}
                      className="text-xs"
                    >
                      <Filter data-icon="inline-start" />
                      {activeCollectionIds.length > 0
                        ? t`合集 · ${activeCollectionIdsLength}`
                        : t`合集`}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
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
                          onCheckedChange={() =>
                            toggleCollection(collection.id)
                          }
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
            />
            {isSearching && searching && results === null ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-xs">
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                <Trans>正在检索…</Trans>
              </div>
            ) : isSearching ? (
              <>
                <div className="min-h-0 flex-1">
                  {results !== null && results.length > 0 ? (
                    <SearchResultList
                      items={results}
                      query={effectiveQuery}
                      selectedUid={search.poem}
                      onSelect={handleSelect}
                    />
                  ) : results !== null ? (
                    <p className="text-muted-foreground py-10 text-center text-sm">
                      <Trans>没有找到作品</Trans>
                    </p>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                {!activeCollectionIds.length ? (
                  <DailyCard daily={daily} onSelect={handleSelect} />
                ) : null}
                <div className="min-h-0 flex-1">
                  <PoemList
                    resetKey={`browse:${activeCollectionIds.join(",")}`}
                    collectionIds={activeCollectionIds}
                    selectedUid={search.poem}
                    onSelect={handleSelect}
                  />
                </div>
              </>
            )}
          </div>
        </Panel>
        <Separator
          className="group bg-border/60 hover:bg-primary/50 data-[resize-handle-active]:bg-primary/60 relative w-px shrink-0 transition-colors"
          aria-label={t`调整双栏宽度`}
        />
        <Panel id="library-detail" defaultSize="66" minSize="40">
          <div
            key={detail?.uid ?? "empty"}
            className="animate-in fade-in h-full duration-200"
          >
            <PoemDetailPane
              detail={detail}
              loading={detailLoading}
              fontSize={fontSize}
              lineHeight={lineHeight}
              onFontSizeChange={setFontSize}
              onLineHeightChange={setLineHeight}
            />
          </div>
        </Panel>
      </Group>
    </main>
  );
}
