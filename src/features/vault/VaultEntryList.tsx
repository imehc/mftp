import { useRef } from "react";
import { useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensors,
  useSensor,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import VaultEntryCard from "./VaultEntryCard";
import type { VaultController } from "./use-vault";

export default function VaultEntryList({
  controller: c,
}: {
  controller: VaultController;
}) {
  const { t } = useLingui();
  const scroller = useRef<HTMLDivElement>(null);
  const wide = useDesktopLayout();
  const columns = wide && !c.sorting ? 2 : 1;
  const rows = Array.from(
    { length: Math.ceil(c.filtered.length / columns) },
    (_, i) => c.filtered.slice(i * columns, (i + 1) * columns),
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    getItemKey: (i) => rows[i].map((e) => e.id).join(":"),
    estimateSize: () => 250,
    overscan: 3,
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  return (
    <DndContext
      accessibility={{
        screenReaderInstructions: {
          draggable: t`按空格开始排序，用方向键移动，再按空格确认，按 Escape 取消。`,
        },
        announcements: {
          onDragStart: () => t`已开始调整账号顺序`,
          onDragOver: ({ over }) => {
            const position = over
              ? c.filtered.findIndex((e) => e.id === over.id) + 1
              : 0;
            return position ? t`移动到第 ${position} 项` : t`当前位置不可放置`;
          },
          onDragEnd: () => t`排序操作结束`,
          onDragCancel: () => t`已取消排序`,
        },
      }}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (over) void c.reorder(String(active.id), String(over.id));
      }}
    >
      <SortableContext
        items={c.filtered.map((e) => e.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={scroller}
          className="app-scroll-safe-end min-h-0 flex-1 overflow-y-auto"
        >
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((row) => (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 grid w-full gap-3 pb-3"
                style={{
                  transform: `translateY(${row.start}px)`,
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {rows[row.index].map((entry) => (
                  <VaultEntryCard
                    key={entry.id}
                    entry={entry}
                    sortable={c.canSort}
                    busy={c.busy}
                    onEdit={() => c.edit(entry)}
                    onDelete={() => c.setDeleting(entry)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </SortableContext>
    </DndContext>
  );
}
