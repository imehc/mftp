import { Trans, useLingui } from "@lingui/react/macro";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useEffectEvent, useRef } from "react";

import { Button } from "~/components/ui/button";
import { describeError } from "~/lib/errors";
import { useVirtualizerFontSize } from "~/lib/root-font-size";

import { browseQuery } from "../queries";
import PoemCard from "./PoemCard";

interface PoemListProps {
  /** 改变此 key 会重置列表（筛选 / 范围 / 查询发生变化）。 */
  resetKey: string;
  query?: string;
  collectionIds: string[];
  selectedUid?: string;
  onSelect: (uid: string) => void;
  onCountChange?: (count: number | null) => void;
  /** 移动端详情返回时恢复列表滚动锚点。 */
  scrollStorageKey?: string;
}

/**
 * 基于游标分页、虚拟化的诗词列表。每次滚动加载一页；
 * 绝不一次拉取整库（25 万余首宋词必须保持惰性加载）。
 */
export default function PoemList({
  resetKey,
  query,
  collectionIds,
  selectedUid,
  onSelect,
  onCountChange,
  scrollStorageKey,
}: PoemListProps) {
  const { t } = useLingui();
  const scrollRef = useRef<HTMLDivElement>(null);
  const browse = useInfiniteQuery(browseQuery(collectionIds));
  const state = {
    items: browse.data?.pages.flatMap((page) => page.items) ?? [],
    exhausted: !browse.isPending && !browse.hasNextPage,
  };
  const loading = browse.isFetching;
  const error = browse.error;
  const loadMore = () =>
    browse.data && !browse.isRefetchError
      ? browse.fetchNextPage({ cancelRefetch: false })
      : browse.refetch({ cancelRefetch: false });
  const restoredScroll = useRef(false);
  // onCountChange 是属性回调；通过 effect event 读取最新值，
  // 使重置 effect 只依赖重置 key。
  const notifyCountReset = useEffectEvent(() => onCountChange?.(null));
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: 0,
    });
    restoredScroll.current = false;
    notifyCountReset();
  }, [resetKey]);

  useEffect(() => {
    if (!scrollStorageKey || state.items.length === 0 || restoredScroll.current)
      return;
    try {
      const saved = Number(sessionStorage.getItem(scrollStorageKey));
      if (Number.isFinite(saved) && saved > 0) {
        requestAnimationFrame(() =>
          scrollRef.current?.scrollTo({ top: saved }),
        );
      }
    } catch {
      // 存储不可用时仍保持列表可读。
    }
    restoredScroll.current = true;
  }, [scrollStorageKey, state.items.length]);

  const virtualizer = useVirtualizer({
    count: state.items.length + (state.exhausted || error ? 0 : 1),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 92,
    overscan: 8,
  });
  useVirtualizerFontSize(virtualizer);
  return (
    <div
      ref={scrollRef}
      role="list"
      aria-label={t`诗词列表`}
      className="app-scroll-safe-end h-full min-h-0 flex-1 overflow-y-auto px-2 pt-2"
      onScroll={(event) => {
        const el = event.currentTarget;
        if (scrollStorageKey) {
          try {
            sessionStorage.setItem(scrollStorageKey, String(el.scrollTop));
          } catch {
            // 存储不可用时忽略滚动位置持久化。
          }
        }
        const nearBottom =
          el.scrollTop + el.clientHeight >= el.scrollHeight - 240;
        if (nearBottom && !loading && !state.exhausted && !error) {
          void loadMore();
        }
      }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const poem = state.items[virtualRow.index];
          return (
            <div
              key={poem?.uid ?? `loading-${virtualRow.index}`}
              role="listitem"
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {poem ? (
                <div>
                  <PoemCard
                    poem={poem}
                    query={query}
                    active={poem.uid === selectedUid}
                    onSelect={onSelect}
                  />
                </div>
              ) : (
                <div className="text-muted-foreground flex h-21 items-center justify-center text-xs">
                  <Trans>加载中…</Trans>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error ? (
        <div role="alert" className="flex flex-col gap-2 p-3 text-sm">
          <p>{describeError(error, t)}</p>
          <Button variant="outline" onClick={() => void loadMore()}>
            <Trans>重试</Trans>
          </Button>
        </div>
      ) : null}
      {!error && state.exhausted && state.items.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">
          {t`没有找到作品`}
        </p>
      ) : null}
    </div>
  );
}
