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
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trans, useLingui } from "@lingui/react/macro";
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
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="grid gap-2">
          {entries.map((entry) => (
            <SortableFeatureEntry key={entry.id} entry={entry} />
          ))}
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
    <section className="bg-card min-w-0 rounded-xl border p-3">
      <div className="mb-3 flex items-start gap-3">
        <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
          <LayoutGrid aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            <Trans>功能入口</Trans>
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            <Trans comment="设置页功能入口中的简短说明，介绍可拖动列表的用途。">
              拖动调整首页功能的显示顺序
            </Trans>
          </p>
        </div>
      </div>
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
          description={categoryVisible ? t`已开启` : t`已关闭`}
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
        <TabsContent value="tools" className="mt-3">
          <CategoryOrder category="tools" />
        </TabsContent>
        <TabsContent value="library" className="mt-3">
          <CategoryOrder category="library" />
        </TabsContent>
        <TabsContent value="games" className="mt-3">
          <CategoryOrder category="games" />
        </TabsContent>
      </Tabs>
    </section>
  );
}
