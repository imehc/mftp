import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLingui } from "@lingui/react/macro";
import { Gamepad2, GripVertical, LayoutGrid } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  availableHomeEntries,
  type HomeCategory,
  homeCategoryLabels,
  type HomeEntry,
  orderedHomeEntries,
} from "~/features/home/entries";
import { useSettingsStore } from "~/store/settings";

import SettingsControl from "./SettingsControl";

function SortableFeatureEntry({ entry }: { entry: HomeEntry }) {
  const { t } = useLingui();
  const visible = useSettingsStore(
    (state) => state.homeEntryVisibility[entry.id] !== false,
  );
  const setVisible = useSettingsStore((state) => state.setHomeEntryVisible);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id });
  const Icon = entry.icon;
  return (
    <div
      ref={setNodeRef}
      className="bg-background flex min-h-12 items-center gap-3 rounded-lg border px-2"
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        density="adaptive"
        className="touch-none"
        {...attributes}
        {...listeners}
        aria-label={t`拖动排序`}
        title={t`拖动排序`}
      >
        <GripVertical />
      </Button>
      <Switch
        checked={visible}
        onCheckedChange={(value) => setVisible(entry.id, value)}
        aria-label={t`显示此功能`}
      />
    </div>
  );
}

function CategoryOrder({ category }: { category: HomeCategory }) {
  const { t } = useLingui();
  const saved = useSettingsStore((state) => state.homeEntryOrder[category]);
  const setOrder = useSettingsStore((state) => state.setHomeEntryOrder);
  const entries = orderedHomeEntries(category, saved, availableHomeEntries);
  const ids: string[] = entries.map((entry) => entry.id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{
        screenReaderInstructions: {
          draggable: t({
            comment: "键盘用户在功能入口拖拽排序时听到的操作说明",
            message:
              "按空格开始排序，用方向键移动，再按空格确认，按 Escape 取消。",
          }),
        },
      }}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return;
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from < 0 || to < 0) return;
        const next = arrayMove(ids, from, to);
        setOrder(category, next);
      }}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="@container/feature-entries">
          <div className="grid grid-cols-1 gap-2 @min-[32rem]/feature-entries:grid-cols-2">
            {entries.map((entry) => (
              <SortableFeatureEntry key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      </SortableContext>
    </DndContext>
  );
}

export default function FeatureEntrySettings() {
  const { t } = useLingui();
  const hiddenCategories = useSettingsStore(
    (state) => state.hiddenHomeCategories,
  );
  const setCategoryVisible = useSettingsStore(
    (state) => state.setHomeCategoryVisible,
  );
  const [category, setCategory] = useState<HomeCategory>("tools");
  const homeEntryVisibility = useSettingsStore(
    (state) => state.homeEntryVisibility,
  );
  const categoryEntries = availableHomeEntries.filter(
    (entry) => entry.category === category,
  );
  const hasVisibleEntries = categoryEntries.some(
    (entry) => homeEntryVisibility[entry.id] !== false,
  );
  const categoryVisible =
    !hiddenCategories.includes(category) && hasVisibleEntries;
  return (
    <section
      aria-label={t`功能入口`}
      className="bg-card min-w-0 rounded-xl border p-3"
    >
      <Tabs
        value={category}
        onValueChange={(value) => setCategory(value as HomeCategory)}
      >
        <TabsList className="w-full" density="adaptive">
          <TabsTrigger value="tools">{homeCategoryLabels.tools}</TabsTrigger>
          <TabsTrigger value="library">
            {homeCategoryLabels.library}
          </TabsTrigger>
          <TabsTrigger value="games">{homeCategoryLabels.games}</TabsTrigger>
        </TabsList>
        <SettingsControl
          icon={category === "games" ? Gamepad2 : LayoutGrid}
          title={t`显示此分类`}
          id="settings-feature-category"
          compact
        >
          <Switch
            id="settings-feature-category"
            checked={categoryVisible}
            onCheckedChange={(value) => {
              if (value) {
                categoryEntries.forEach((entry) =>
                  useSettingsStore
                    .getState()
                    .setHomeEntryVisible(entry.id, true),
                );
              }
              setCategoryVisible(category, value);
            }}
          />
        </SettingsControl>
        <TabsContent value="tools">
          <CategoryOrder category="tools" />
        </TabsContent>
        <TabsContent value="library">
          <CategoryOrder category="library" />
        </TabsContent>
        <TabsContent value="games">
          <CategoryOrder category="games" />
        </TabsContent>
      </Tabs>
    </section>
  );
}
