import { Mesh, type PerspectiveCamera, type Vector3 } from "three";

import type { ModelEntry } from "../runtime/collection";
import { ModelDiagnostics } from "./diagnostics";
import { ModelMeasurement } from "./measurement";
import { MaterialPreview, type MaterialView } from "./preview";

export type InteractionMode = "orbit" | "place" | "fly" | "measure";

export type Unit = "m" | "cm" | "mm" | "ft";

export const unitFactor: Record<Unit, number> = {
  m: 1,
  cm: 100,
  mm: 1000,
  ft: 1 / 0.3048,
};

export type MorphView = { id: string; name: string; value: number };

export type SavedView = {
  id: string;
  name: string;
  position: number[];
  target: number[];
  near: number;
  far: number;
};

type ToolState = {
  mode: InteractionMode;
  unit: Unit;
  points: number;
  distance: number | null;
  wireframe: boolean;
  normals: boolean;
  shadows: boolean;
  autoRotate: boolean;
  materials: MaterialView[];
  morphs: MorphView[];
  views: SavedView[];
};

export class InspectionTools {
  private state: ToolState = {
    mode: "orbit",
    unit: "m",
    points: 0,
    distance: null,
    wireframe: false,
    normals: false,
    shadows: false,
    autoRotate: false,
    materials: [],
    morphs: [],
    views: [],
  };
  private listeners = new Set<() => void>();
  private preview: MaterialPreview | null = null;
  private morphs = new Map<
    string,
    { mesh: Mesh; index: number; original: number }
  >();
  private poseVersion = 0;
  private selected: ModelEntry | undefined;
  private lastMorphSnapshot = 0;
  readonly diagnostics = new ModelDiagnostics();
  readonly measurement: ModelMeasurement;
  constructor(
    canvas: HTMLCanvasElement,
    camera: PerspectiveCamera,
    private current: () => ModelEntry | undefined,
    private invalidate: () => void,
  ) {
    this.measurement = new ModelMeasurement(
      canvas,
      camera,
      current,
      (points, distance) => {
        this.publish({ points, distance });
        this.invalidate();
      },
    );
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  publish(patch: Partial<ToolState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  setUnit(unit: Unit) {
    this.publish({ unit });
  }
  selectionChanged() {
    const entry = this.current();
    if (this.selected === entry) return;
    this.detach();
    this.selected = entry;
    if (entry) {
      this.poseVersion = entry.animation.poseVersion;
      this.preview = new MaterialPreview(entry, this.invalidate);
      entry.handle.scene.traverse((node) => {
        if (!(node instanceof Mesh) || !node.morphTargetInfluences) return;
        node.morphTargetInfluences.forEach((value, index) =>
          this.morphs.set(`${node.uuid}:${index}`, {
            mesh: node,
            index,
            original: value,
          }),
        );
      });
    }
    this.publish({
      materials: this.preview?.materials() ?? [],
      morphs: this.morphViews(),
      wireframe: false,
      normals: false,
    });
  }
  detach() {
    this.diagnostics.clear();
    this.measurement.clear();
    this.preview?.dispose();
    this.preview = null;
    this.restoreMorphs();
    this.morphs.clear();
  }
  syncPose() {
    const version = this.current()?.animation.poseVersion ?? 0;
    if (version === this.poseVersion) return;
    this.poseVersion = version;
    if (this.state.points) this.measurement.clear();
    this.diagnostics.invalidatePose();
    if (this.morphs.size && performance.now() - this.lastMorphSnapshot >= 100) {
      this.lastMorphSnapshot = performance.now();
      this.publish({ morphs: this.morphViews() });
    }
  }
  private morphViews(): MorphView[] {
    return [...this.morphs].map(([id, { mesh, index }]) => ({
      id,
      name: `${mesh.name || mesh.type} · ${Object.entries(mesh.morphTargetDictionary ?? {}).find(([, i]) => i === index)?.[0] ?? index}`,
      value: mesh.morphTargetInfluences![index],
    }));
  }
  setMorph(id: string, value: number) {
    const target = this.morphs.get(id);
    if (!target || !Number.isFinite(value)) return;
    this.current()?.animation.pause();
    this.measurement.clear();
    this.diagnostics.invalidatePose();
    target.mesh.morphTargetInfluences![target.index] = Math.max(
      -1,
      Math.min(2, value),
    );
    this.publish({ morphs: this.morphViews() });
    this.invalidate();
  }
  private restoreMorphs() {
    for (const { mesh, index, original } of this.morphs.values())
      mesh.morphTargetInfluences![index] = original;
  }
  display(wireframe: boolean, normals: boolean) {
    this.preview?.display(wireframe, normals);
    this.publish({ wireframe, normals });
  }
  editMaterial(id: string, patch: Partial<MaterialView>) {
    this.preview?.edit(id, patch);
    this.publish({ materials: this.preview?.materials() ?? [] });
  }
  resetPreview() {
    this.current()?.animation.pause();
    this.restoreMorphs();
    this.preview?.reset();
    this.measurement.clear();
    this.diagnostics.invalidatePose();
    this.publish({
      materials: this.preview?.materials() ?? [],
      morphs: this.morphViews(),
      wireframe: false,
      normals: false,
    });
    this.invalidate();
  }
  saveView(name: string, camera: PerspectiveCamera, target: Vector3) {
    if (!name.trim() || this.state.views.length >= 20) return;
    const view = {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, 80),
      position: camera.position.toArray(),
      target: target.toArray(),
      near: camera.near,
      far: camera.far,
    };
    this.publish({ views: [...this.state.views, view] });
  }
  removeView(id: string) {
    this.publish({ views: this.state.views.filter((v) => v.id !== id) });
  }
  dispose() {
    this.diagnostics.dispose();
    this.measurement.dispose();
    this.preview?.dispose();
    this.restoreMorphs();
    this.morphs.clear();
    this.listeners.clear();
  }
}
