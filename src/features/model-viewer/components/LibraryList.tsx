import { useEffect, useId, useRef, useState } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { Trans, useLingui } from "@lingui/react/macro";
import { Box, MoreHorizontal, Pencil, Star, Trash2 } from "lucide-react";
import type { ModelLibraryEntry } from "~/bindings";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { modelLibraryReadThumbnail } from "~/lib/ipc";
import { formatBytes } from "~/lib/format";
import type { ModelLibraryController } from "../library/controller";

function Thumbnail({
  entry,
  controller,
}: {
  entry: ModelLibraryEntry;
  controller: ModelLibraryController;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (entry.hasThumbnail)
      void modelLibraryReadThumbnail(entry.id)
        .then((value) => {
          if (active) setUrl(value);
        })
        .catch(controller.report);
    return () => {
      active = false;
    };
  }, [entry.id, entry.hasThumbnail, controller]);
  return url && entry.hasThumbnail ? (
    <img
      src={url}
      alt=""
      className="size-12 shrink-0 rounded-md object-contain"
    />
  ) : (
    <Box
      className="text-muted-foreground m-3 size-6 shrink-0"
      aria-hidden="true"
    />
  );
}

export function LibraryList({
  entries,
  controller,
  busy,
  open,
  edit,
  remove,
}: {
  entries: ModelLibraryEntry[];
  controller: ModelLibraryController;
  busy: boolean;
  open: (id: string) => void;
  edit: (entry: ModelLibraryEntry, trigger: HTMLElement | null) => void;
  remove: (entry: ModelLibraryEntry, trigger: HTMLElement | null) => void;
}) {
  const { t } = useLingui();
  const listId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [focused, setFocused] = useState(0);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => viewport.current,
    getItemKey: (index) => entries[index].id,
    estimateSize: () =>
      (probe.current?.getBoundingClientRect().height || 16) * 5,
    overscan: 3,
    rangeExtractor: (range) =>
      [
        ...new Set([
          ...defaultRangeExtractor(range),
          Math.min(focused, entries.length - 1),
        ]),
      ]
        .filter((i) => i >= 0)
        .sort((a, b) => a - b),
  });
  useEffect(() => {
    const observer = new ResizeObserver(() => virtualizer.measure());
    if (probe.current) observer.observe(probe.current);
    return () => observer.disconnect();
  }, [virtualizer]);
  return (
    <div
      ref={viewport}
      className="relative h-72 min-h-48 flex-1 overflow-auto rounded-lg border md:h-96"
      role="list"
      aria-label={t({ message: "已保存模型", comment: "本机模型库条目列表。" })}
      onKeyDown={(event) => {
        if (
          !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
          !entries.length
        )
          return;
        event.preventDefault();
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? entries.length - 1
              : Math.max(
                  0,
                  Math.min(
                    entries.length - 1,
                    focused + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                );
        setFocused(index);
        virtualizer.scrollToIndex(index);
        requestAnimationFrame(() =>
          document.getElementById(`${listId}-${index}`)?.focus(),
        );
      }}
    >
      <span
        ref={probe}
        className="pointer-events-none absolute h-[1rem] w-px"
        aria-hidden="true"
      />
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const entry = entries[row.index];
          return (
            <div
              key={entry.id}
              data-index={row.index}
              ref={virtualizer.measureElement}
              role="listitem"
              className="absolute top-0 left-0 flex w-full min-w-0 flex-wrap items-center gap-1 border-b p-2"
              style={{ transform: `translateY(${row.start}px)` }}
              onFocusCapture={() => setFocused(row.index)}
            >
              <Thumbnail entry={entry} controller={controller} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Button
                  id={`${listId}-${row.index}`}
                  density="adaptive"
                  variant="ghost"
                  className="max-w-full justify-start"
                  title={entry.name}
                  disabled={busy}
                  onClick={() => open(entry.id)}
                >
                  <span className="truncate">{entry.name}</span>
                  {entry.favorite ? (
                    <Star aria-hidden="true" className="shrink-0" />
                  ) : null}
                </Button>
                <span className="text-muted-foreground truncate px-3 text-xs">
                  {entry.group ? `${entry.group} · ` : ""}
                  {formatBytes(entry.size)}
                </span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    id={`${listId}-actions-${row.index}`}
                    density="adaptive"
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={t({
                      message: "模型操作",
                      comment: "本地模型库条目的编辑和删除菜单。",
                    })}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="ui-density-adaptive"
                >
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onSelect={() =>
                        edit(
                          entry,
                          document.getElementById(
                            `${listId}-actions-${row.index}`,
                          ),
                        )
                      }
                    >
                      <Pencil aria-hidden="true" />
                      <Trans comment="编辑本地模型库的名称、分组和收藏状态。">
                        编辑模型
                      </Trans>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() =>
                        remove(
                          entry,
                          document.getElementById(
                            `${listId}-actions-${row.index}`,
                          ),
                        )
                      }
                    >
                      <Trash2 aria-hidden="true" />
                      <Trans comment="从本机模型库删除此条目，不操作用户的原始文件。">
                        删除模型
                      </Trans>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </div>
      {!entries.length ? (
        <p className="text-muted-foreground p-4 text-sm">
          <Trans>没有匹配的模型</Trans>
        </p>
      ) : null}
    </div>
  );
}
