import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "cn";
import { MessagesSquare } from "lucide-react";
import { useEffect, useRef } from "react";

import type { AgentSessionPage, AgentSessionSummary } from "~/bindings";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { formatBytes } from "~/lib/format";
import { useSettingsStore } from "~/store/settings";

import { AgentIcon, agentName } from "./agents";

const emptyItems: AgentSessionSummary[] = [];

interface Props {
  page: AgentSessionPage | null;
  selected: string | null;
  busy: boolean;
  filtered: boolean;
  offset: number;
  onSelect: (session: AgentSessionSummary) => void;
  onPage: (offset: number) => void;
  onClear: () => void;
  sizes?: ReadonlyMap<string, number | null>;
}

export function SessionResults({
  page,
  selected,
  busy,
  filtered,
  offset,
  onSelect,
  onPage,
  onClear,
  sizes,
}: Props) {
  const { i18n, t } = useLingui();
  const scroll = useRef<HTMLDivElement>(null);
  const size = useSettingsStore((settings) => settings.displaySize);
  const items = page?.items ?? emptyItems;
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 112,
    overscan: 5,
  });
  useEffect(() => {
    virtualizer.measure();
  }, [size, items, virtualizer]);
  const date = new Intl.DateTimeFormat(i18n.locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <section className="border-border flex min-h-0 min-w-0 flex-col @[44rem]/session:border-r">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <h2 className="text-sm font-medium">
          <Trans comment="会话检索结果列表标题">会话</Trans>
        </h2>
        <span className="app-description tabular-nums" role="status">
          {busy ? (
            <Spinner />
          ) : (
            page && (
              <Plural value={page.total} one="# 个结果" other="# 个结果" />
            )
          )}
        </span>
      </div>
      <div
        ref={scroll}
        className="app-scroll-safe-end min-h-0 flex-1 overflow-auto"
      >
        {items.length ? (
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const session = items[row.index];
              const bytes = sizes?.get(session.key);
              return (
                <button
                  key={session.key}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  type="button"
                  onClick={() => onSelect(session)}
                  aria-pressed={selected === session.key}
                  data-selected={selected === session.key}
                  className={cn(
                    "agent-session-row border-border hover:bg-accent focus-visible:ring-ring absolute top-0 left-0 flex w-full flex-col gap-1.5 border-t px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset",
                    `agent-${session.agent}`,
                  )}
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <AgentIcon agent={session.agent} />
                    {session.archived && (
                      <Badge variant="outline">
                        <Trans>已归档</Trans>
                      </Badge>
                    )}
                    <span className="text-muted-foreground text-xs">
                      {agentName(session.agent)}
                    </span>
                    <time
                      dateTime={new Date(session.updatedAt).toISOString()}
                      className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums"
                    >
                      {date.format(session.updatedAt)}
                    </time>
                  </div>
                  <span className="line-clamp-2 text-sm font-semibold">
                    {session.title || <Trans>无标题会话</Trans>}
                  </span>
                  <p className="text-muted-foreground line-clamp-2 text-xs leading-normal">
                    {session.preview}
                  </p>
                  <div className="app-description flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-mono">
                      {session.sessionId ?? <Trans>未记录 session ID</Trans>}
                    </span>
                    <span
                      data-slot="session-storage-size"
                      className="app-description text-muted-foreground flex shrink-0 items-center gap-1.5 tabular-nums"
                      title={
                        bytes === null
                          ? t`共享存储无法独立计量`
                          : bytes === undefined
                            ? t`会话存储占用尚未计量`
                            : t`会话存储占用`
                      }
                    >
                      <span aria-hidden="true">·</span>
                      {bytes === null ? (
                        <Trans comment="会话存储在共享数据库等容器中，无法给出单独的文件大小">
                          无法独立计量
                        </Trans>
                      ) : bytes === undefined ? (
                        "—"
                      ) : (
                        formatBytes(bytes)
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessagesSquare />
              </EmptyMedia>
              <EmptyTitle>
                {busy ? (
                  <Trans>正在检索会话</Trans>
                ) : filtered ? (
                  <Trans>没有匹配的会话</Trans>
                ) : (
                  <Trans>暂无会话记录</Trans>
                )}
              </EmptyTitle>
            </EmptyHeader>
            {filtered && !busy && (
              <EmptyContent>
                <Button variant="outline" onClick={onClear}>
                  <Trans>清除筛选</Trans>
                </Button>
              </EmptyContent>
            )}
          </Empty>
        )}
      </div>
      {page && (offset > 0 || page.nextOffset !== null) && (
        <div className="border-border flex shrink-0 items-center justify-between gap-2 border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={offset === 0 || busy}
            onClick={() => onPage(Math.max(0, offset - 100))}
          >
            <Trans>上一页</Trans>
          </Button>
          <span className="app-description tabular-nums">
            {offset + 1}–{offset + items.length} / {page.total}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page.nextOffset === null || busy}
            onClick={() => page.nextOffset !== null && onPage(page.nextOffset)}
          >
            <Trans>下一页</Trans>
          </Button>
        </div>
      )}
    </section>
  );
}
