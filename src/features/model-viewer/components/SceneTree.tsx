import { useEffect, useId, useRef } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import { Button } from "~/components/ui/button";
import { visibleSceneNodes, type ModelInspection } from "../domain/inspection";

export function SceneTree({
  inspection,
  expanded,
  selected,
  onExpanded,
  onSelected,
  initialOffset,
  onOffset,
}: {
  inspection: ModelInspection;
  expanded: ReadonlySet<string>;
  selected: string;
  onExpanded: (value: Set<string>) => void;
  onSelected: (id: string) => void;
  initialOffset: () => number;
  onOffset: (offset: number) => void;
}) {
  const { t } = useLingui();
  const treeId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const rows = visibleSceneNodes(inspection, expanded);
  const activeIndex = Math.max(
    0,
    rows.findIndex((row) => row.node.id === selected),
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    getItemKey: (index) => rows[index].node.id,
    estimateSize: () =>
      (probe.current?.getBoundingClientRect().height || 16) * 3,
    initialOffset,
    overscan: 6,
    // 活动行保留在 DOM，避免虚拟滚动导致 aria-activedescendant 指向不存在的节点。
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), activeIndex])].sort(
        (a, b) => a - b,
      ),
  });
  useEffect(() => {
    const observer = new ResizeObserver(() => virtualizer.measure());
    if (probe.current) observer.observe(probe.current);
    return () => observer.disconnect();
  }, [virtualizer]);

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onExpanded(next);
    onSelected(id);
  }
  function focus(index: number) {
    const target = Math.max(0, Math.min(rows.length - 1, index));
    onSelected(rows[target].node.id);
    virtualizer.scrollToIndex(target, { align: "auto" });
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p id={`${treeId}-help`} className="text-muted-foreground text-xs">
        <Trans>上下键移动，左右键展开或收起；选择节点可查看关联材质。</Trans>
      </p>
      <div
        ref={viewport}
        role="tree"
        tabIndex={0}
        aria-label={t({
          message: "模型场景树",
          comment: "可展开和键盘导航的三维模型节点树。",
        })}
        aria-describedby={`${treeId}-help`}
        aria-activedescendant={`${treeId}-${rows[activeIndex]?.node.id}`}
        className="focus-visible:ring-ring relative h-64 overflow-auto rounded-lg border focus-visible:ring-2 focus-visible:outline-none md:h-80"
        onScroll={(event) => {
          onOffset(event.currentTarget.scrollTop);
        }}
        onKeyDown={(event) => {
          const node = rows[activeIndex]?.node;
          if (!node) return;
          switch (event.key) {
            case "ArrowDown":
              focus(activeIndex + 1);
              break;
            case "ArrowUp":
              focus(activeIndex - 1);
              break;
            case "Home":
              focus(0);
              break;
            case "End":
              focus(rows.length - 1);
              break;
            case "ArrowRight":
              if (node.children.length) {
                if (!expanded.has(node.id)) toggle(node.id);
                else focus(activeIndex + 1);
              }
              break;
            case "ArrowLeft":
              if (node.children.length && expanded.has(node.id))
                toggle(node.id);
              else if (node.parent)
                focus(rows.findIndex((row) => row.node.id === node.parent));
              break;
            case "Enter":
            case " ":
              if (node.children.length) toggle(node.id);
              break;
            default:
              return;
          }
          event.preventDefault();
        }}
      >
        <span
          ref={probe}
          aria-hidden="true"
          className="pointer-events-none absolute h-[1rem] w-px opacity-0"
        />
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const { node, depth, position, siblings } = rows[item.index];
            const number = item.index + 1;
            const name =
              node.name ||
              t({
                message: `节点 ${number}`,
                comment: "未命名的模型场景节点；number 为当前列表序号。",
              });
            return (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                id={`${treeId}-${node.id}`}
                role="treeitem"
                aria-selected={selected === node.id}
                aria-level={depth + 1}
                aria-posinset={position}
                aria-setsize={siblings}
                aria-expanded={
                  node.children.length ? expanded.has(node.id) : undefined
                }
                className={cn(
                  "absolute top-0 left-0 flex min-h-12 w-full cursor-pointer items-center gap-1 rounded-md pr-2 text-sm",
                  selected === node.id && "bg-accent text-accent-foreground",
                )}
                style={{
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: `${Math.min(depth, 6) * 0.75 + 0.25}rem`,
                }}
                onClick={() => {
                  onSelected(node.id);
                  viewport.current?.focus({ preventScroll: true });
                }}
              >
                {node.children.length ? (
                  <Button
                    variant="ghost"
                    density="adaptive"
                    size="icon-sm"
                    tabIndex={-1}
                    aria-label={t({
                      message: `展开或收起 ${name}`,
                      comment: "场景树节点的展开按钮，name 为模型节点名称。",
                    })}
                    aria-expanded={expanded.has(node.id)}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(node.id);
                      viewport.current?.focus({ preventScroll: true });
                    }}
                  >
                    {expanded.has(node.id) ? (
                      <ChevronDown aria-hidden="true" />
                    ) : (
                      <ChevronRight aria-hidden="true" />
                    )}
                  </Button>
                ) : (
                  <span className="w-8 shrink-0" aria-hidden="true" />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate" title={name}>
                    {name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {node.type}
                  </span>
                </span>
                {selected === node.id ? (
                  <Check className="size-4 shrink-0" aria-hidden="true" />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
