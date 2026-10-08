import { Box3, Group, Vector3 } from "three";
import type { ModelHandle } from "../domain/types";
import { ModelAnimation } from "./animation";
import { frameModel } from "./framing";
import { inspectModel } from "./inspection";
import type { InspectionViewState } from "../domain/inspection";

export type ModelLayout = "row" | "grid" | "ring";
export type ModelEntry = {
  id: string;
  handle: ModelHandle;
  layer: Group;
  baseline: Vector3;
  animation: ModelAnimation;
  inspection: ReturnType<typeof inspectModel>;
  inspectionView: InspectionViewState;
};

export function layoutPositions(count: number, layout: ModelLayout) {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => {
    if (layout === "row")
      return new Vector3((index - (count - 1) / 2) * 3, 0, 0);
    if (layout === "ring" && count > 1) {
      const radius = Math.max(1.5, 1.5 / Math.sin(Math.PI / count));
      const angle = (index / count) * Math.PI * 2;
      return new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    }
    return new Vector3(
      ((index % columns) - (columns - 1) / 2) * 3,
      0,
      (Math.floor(index / columns) - (rows - 1) / 2) * 3,
    );
  });
}

export class ModelCollection {
  readonly root = new Group();
  readonly entries = new Map<string, ModelEntry>();
  selected: string | null = null;
  layout: ModelLayout = "row";
  constructor(private invalidate: () => void) {}

  prepare(id: string, handle: ModelHandle): ModelEntry {
    return {
      id,
      handle,
      layer: frameModel(handle.scene),
      baseline: new Vector3(),
      animation: new ModelAnimation(
        handle.scene,
        handle.animations,
        this.invalidate,
      ),
      inspection: inspectModel(handle),
      inspectionView: {
        tab: "info",
        expanded: new Set([handle.scene.uuid]),
        selected: handle.scene.uuid,
        active: null,
        offset: 0,
      },
    };
  }
  add(entry: ModelEntry) {
    // 追加不挪动现有模型；新项放在当前边界右侧，显式布局才重排。
    const box = this.bounds();
    if (!box.isEmpty()) entry.layer.position.x = box.max.x + 2;
    entry.baseline.copy(entry.layer.position);
    this.entries.set(entry.id, entry);
    this.root.add(entry.layer);
    this.selected = entry.id;
  }
  get current() {
    return this.selected ? this.entries.get(this.selected) : undefined;
  }
  arrange(layout: ModelLayout) {
    this.layout = layout;
    const positions = layoutPositions(this.entries.size, layout);
    [...this.entries.values()].forEach((entry, index) => {
      entry.layer.position.copy(positions[index]);
      entry.baseline.copy(positions[index]);
    });
    this.invalidate();
  }
  move(id: string, position: readonly number[]) {
    if (
      position.length !== 3 ||
      !position.every((n) => Number.isFinite(n) && Math.abs(n) <= 10000)
    )
      return;
    this.entries
      .get(id)
      ?.layer.position.set(position[0], position[1], position[2]);
    this.invalidate();
  }
  reset(id: string) {
    const entry = this.entries.get(id);
    if (entry) entry.layer.position.copy(entry.baseline);
    this.invalidate();
  }
  bounds(id?: string) {
    const box = new Box3();
    for (const entry of this.entries.values())
      if (entry.layer.visible && (!id || entry.id === id))
        box.union(new Box3().setFromObject(entry.layer));
    return box;
  }
  update(delta: number) {
    let running = false;
    for (const entry of this.entries.values()) {
      if (!entry.layer.visible) continue;
      entry.animation.update(delta);
      running ||= entry.animation.running;
    }
    return running;
  }
  remove(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.animation.dispose();
    entry.layer.removeFromParent();
    entry.handle.dispose();
    entry.layer.clear();
    this.entries.delete(id);
    if (this.selected === id)
      this.selected = this.entries.keys().next().value ?? null;
    this.invalidate();
  }
  dispose() {
    for (const id of this.entries.keys()) this.remove(id);
  }
}
