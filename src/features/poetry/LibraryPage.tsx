import ActivityMenu from "~/features/transfers/ActivityMenu";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  ArrowLeft,
  BookMarked,
  Filter,
  LoaderCircle,
  Shuffle,
  SlidersHorizontal,
} from "lucide-react";
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
import PoetryReadError from "./components/PoetryReadError";
import DailyPoemLink from "./components/DailyPoemLink";
import type { PoemSummary } from "~/types";
import PoemCard from "./components/PoemCard";
import PoemDetailPane from "./components/PoemDetail";
import PoemList from "./components/PoemList";
import SearchBar from "./components/SearchBar";
import { usePoetryLibrary } from "./hooks/use-poetry-library";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import { TOUCH_TARGET_CLASS } from "~/lib/touch";
import { usePoetryStore } from "./store/poetry-store";

interface LibraryPageProps {
  search: {
    q?: string;
    poem?: string;
  };
  onSearchChange: (patch: { q?: string }) => void;
  onOpenPoem: (uid: string) => void;
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
    <div
      className="app-scroll-safe-end h-full overflow-y-auto px-2"
      role="list"
    >
      {items.map((poem) => (
        <div key={poem.uid} role="listitem">
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
  // 同一个 controller 和列表槽位跨断点存活，保留搜索草稿和滚动状态。
  const narrow = !useDesktopLayout();
  const toggleCollection = usePoetryStore((s) => s.toggleCollection);
  const clearCollectionFilter = usePoetryStore((s) => s.clearCollectionFilter);
  const setScope = usePoetryStore((s) => s.setSearchScope);
  const history = usePoetryStore((s) => s.searchHistory);
  const removeHistory = usePoetryStore((s) => s.removeSearchHistory);
  const clearHistory = usePoetryStore((s) => s.clearSearchHistory);
  const fontSize = usePoetryStore((s) => s.fontSize);
  const lineHeight = usePoetryStore((s) => s.lineHeight);
  const setFontSize = usePoetryStore((s) => s.setFontSize);
  const setLineHeight = usePoetryStore((s) => s.setLineHeight);
  // 搜索 / 详情 / 合集行为与移动页共用一个 controller，避免两端漂移。
  const {
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
    detailError,
    retryDetail,
    installedCount,
    loadedOnce,
    collectionsError,
    collectionsLoading,
    retryCollections,
    searchError,
    retrySearch,
    handleSelect,
    handleSubmit,
    handleRandom,
  } = usePoetryLibrary({ search, onSearchChange, onOpenPoem });
  const manageLink = (
    <Button variant="ghost" size="icon-sm" asChild>
      <Link
        aria-label={t`数据管理`}
        title={t`数据管理`}
        to="/library/manage"
        search={{ q: search.q, poem: search.poem }}
      >
        <SlidersHorizontal data-icon="inline-start" />
      </Link>
    </Button>
  );
  if (loadedOnce && installedCount === 0) {
    return (
      <main className="bg-background text-foreground flex h-full flex-col">
        <ToolPageHeader
          status={<ActivityMenu />}
          showHome={false}
          title={<Trans>古诗词</Trans>}
          trailing={manageLink}
        />
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
  const searchToolbar = (
    <SearchBar
      input={input}
      scope={scope}
      history={history}
      filterSlot={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`按合集筛选`}
              title={t`按合集筛选`}
            >
              <Filter />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            // 触发器贴在面板最左边，右对齐会把更宽的菜单推出视口，
            // 再被碰撞检测推回来，结果和按钮完全脱钩。
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
      onSubmit={handleSubmit}
      onRemoveHistory={removeHistory}
      onClearHistory={clearHistory}
    />
  );
  const listPane = (
    <div className="flex h-full flex-col">
      {collectionsError ? (
        <PoetryReadError error={collectionsError} onRetry={retryCollections} />
      ) : searchError && isSearching ? (
        <PoetryReadError error={searchError} onRetry={retrySearch} />
      ) : collectionsLoading ||
        (isSearching && searching && results === null) ? (
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
                query={query}
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
          {!activeCollectionIds.length && daily ? (
            <DailyPoemLink poem={daily} onSelect={handleSelect} />
          ) : null}
          <div className="min-h-0 flex-1">
            <PoemList
              resetKey={`browse:${activeCollectionIds.join(",")}`}
              collectionIds={activeCollectionIds}
              selectedUid={search.poem}
              onSelect={handleSelect}
              scrollStorageKey="mftp-poetry-mobile-scroll"
            />
          </div>
        </>
      )}
    </div>
  );
  const detailPane = (
    <div
      key={detail?.uid ?? "empty"}
      className="animate-in fade-in h-full duration-200"
    >
      {detailError ? (
        <PoetryReadError error={detailError} onRetry={retryDetail} />
      ) : (
        <PoemDetailPane
          detail={detail}
          loading={detailLoading}
          fontSize={fontSize}
          lineHeight={lineHeight}
          onFontSizeChange={setFontSize}
          onLineHeightChange={setLineHeight}
        />
      )}
    </div>
  );
  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 flex-col"
    >
      <ToolPageHeader
        status={<ActivityMenu />}
        showHome={false}
        title={<Trans>古诗词</Trans>}
        trailing={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void handleRandom(handleSelect)}
              aria-label={t`随机`}
            >
              <Shuffle data-icon="inline-start" />
            </Button>
            {manageLink}
          </>
        }
      />
      {searchToolbar}
      <Group
        orientation={narrow ? "vertical" : "horizontal"}
        className="min-h-0 flex-1 overflow-hidden"
      >
        <Panel
          id="library-list"
          defaultSize="30"
          minSize="20"
          className={narrow && search.poem ? "hidden" : ""}
        >
          {listPane}
        </Panel>
        <Separator
          className={narrow ? "hidden" : "bg-border w-px shrink-0"}
          aria-label={t`调整双栏宽度`}
        />
        <Panel
          id="library-detail"
          defaultSize="70"
          minSize="40"
          className={narrow && !search.poem ? "hidden" : ""}
        >
          <div className="flex h-full min-h-0 flex-col">
            {narrow ? (
              <div className="flex shrink-0 items-center border-b px-2 py-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className={TOUCH_TARGET_CLASS}
                  onClick={() => onOpenPoem("")}
                >
                  <ArrowLeft data-icon="inline-start" />
                  <Trans>返回列表</Trans>
                </Button>
              </div>
            ) : null}
            <div className="min-h-0 flex-1">{detailPane}</div>
          </div>
        </Panel>
      </Group>
    </main>
  );
}
