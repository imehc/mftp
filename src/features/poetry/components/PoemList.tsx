import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { poetryBrowse } from "~/lib/ipc";
import type { PoemSummary } from "~/types";
import PoemCard from "./PoemCard";
const PAGE_SIZE = 60;
interface PoemListProps {
  /** 改变此 key 会重置列表（筛选 / 范围 / 查询发生变化）。 */
  resetKey: string;
  query?: string;
  collectionIds: string[];
  selectedUid?: string;
  onSelect: (uid: string) => void;
  onCountChange?: (count: number | null) => void;
}
interface BrowseState {
  items: PoemSummary[];
  cursor: string | null;
  exhausted: boolean;
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
}: PoemListProps) {
  const { t } = useLingui();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<BrowseState>({
    items: [],
    cursor: null,
    exhausted: false,
  });
  const [loading, setLoading] = useState(false);
  const loadSeq = useRef(0);
  // onCountChange 是属性回调；通过 effect event 读取最新值，
  // 使重置 effect 只依赖重置 key。
  const notifyCountReset = useEffectEvent(() => onCountChange?.(null));
  useEffect(() => {
    setState({
      items: [],
      cursor: null,
      exhausted: false,
    });
    scrollRef.current?.scrollTo({
      top: 0,
    });
    notifyCountReset();
  }, [resetKey]);
  const loadMore = async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const page = await poetryBrowse({
        collectionIds: collectionIds.length > 0 ? collectionIds : null,
        author: null,
        cursor: state.cursor,
        limit: PAGE_SIZE,
      });
      if (seq !== loadSeq.current) return;
      setState((prev) => ({
        items:
          state.cursor === null ? page.items : [...prev.items, ...page.items],
        cursor: page.nextCursor ?? null,
        exhausted: !page.nextCursor,
      }));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  // 初次加载与后续加载。onScroll 复用 loadMore，因此通过 effect event
  // 读取，而不是每次渲染都重新订阅。
  const loadMoreInEffect = useEffectEvent(loadMore);
  useEffect(() => {
    if (!state.exhausted && state.items.length === 0 && !loading) {
      void loadMoreInEffect();
    }
  }, [state.exhausted, state.items.length, loading]);
  const virtualizer = useVirtualizer({
    count: state.items.length + (state.exhausted ? 0 : 1),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 92,
    overscan: 8,
  });
  return (
    <div
      ref={scrollRef}
      role="list"
      aria-label={t`诗词列表`}
      className="h-full overflow-y-auto px-2 pb-4"
      onScroll={(event) => {
        const el = event.currentTarget;
        const nearBottom =
          el.scrollTop + el.clientHeight >= el.scrollHeight - 240;
        if (nearBottom && !loading && !state.exhausted) {
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
                <div className="pb-2">
                  <PoemCard
                    poem={poem}
                    query={query}
                    active={poem.uid === selectedUid}
                    onSelect={onSelect}
                  />
                </div>
              ) : (
                <div className="text-muted-foreground flex h-[84px] items-center justify-center text-xs">
                  <Trans>加载中…</Trans>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {state.exhausted && state.items.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">
          {t`没有找到作品`}
        </p>
      ) : null}
    </div>
  );
}
