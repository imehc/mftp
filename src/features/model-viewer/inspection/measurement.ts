import {
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
  type PerspectiveCamera,
} from "three";
import type { ModelEntry } from "../runtime/collection";
import { sourcePoint } from "./geometry";

export class ModelMeasurement {
  enabled = false;
  private points: Vector3[] = [];
  private group = new Group();
  private geometry = new SphereGeometry(1, 10, 8);
  private material = new MeshBasicMaterial({
    color: 0xffc857,
    depthTest: false,
  });
  private lineMaterial = new LineBasicMaterial({
    color: 0xffc857,
    depthTest: false,
  });
  private line: Line | null = null;
  private entry: ModelEntry | undefined;
  private down: { id: number; x: number; y: number } | null = null;
  constructor(
    private canvas: HTMLCanvasElement,
    private camera: PerspectiveCamera,
    private current: () => ModelEntry | undefined,
    private changed: (points: number, distance: number | null) => void,
  ) {
    canvas.addEventListener("pointerdown", this.start, true);
    canvas.addEventListener("pointerup", this.pick, true);
    canvas.addEventListener("pointercancel", this.cancel);
  }
  private start = (e: PointerEvent) => {
    if (!this.enabled || this.down || e.button !== 0) return;
    this.down = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  private cancel = () => {
    this.down = null;
  };
  private pick = (e: PointerEvent) => {
    const down = this.down;
    this.down = null;
    if (
      !this.enabled ||
      down?.id !== e.pointerId ||
      Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8
    )
      return;
    const rect = this.canvas.getBoundingClientRect();
    this.pickAt(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    e.stopImmediatePropagation();
  };
  pickAt(x = 0, y = 0) {
    const entry = this.current();
    if (!this.enabled || !entry?.layer.visible) return;
    entry.layer.updateWorldMatrix(true, true);
    this.camera.updateMatrixWorld();
    const meshes: Mesh[] = [];
    entry.handle.scene.traverseVisible((node) => {
      if (node instanceof Mesh) meshes.push(node);
    });
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(x, y), this.camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) this.add(entry, hit.point);
  }
  add(entry: ModelEntry, world: Vector3) {
    if (this.entry !== entry || this.points.length === 2) this.clear();
    this.entry = entry;
    entry.handle.scene.parent!.add(this.group);
    const point = sourcePoint(entry, world);
    this.points.push(point);
    const marker = new Mesh(this.geometry, this.material);
    marker.position.copy(point);
    marker.scale.setScalar(0.015 / entry.layer.scale.x);
    marker.renderOrder = 100;
    this.group.add(marker);
    if (this.points.length === 2) {
      this.line = new Line(
        new BufferGeometry().setFromPoints(this.points),
        this.lineMaterial,
      );
      this.line.renderOrder = 100;
      this.group.add(this.line);
    }
    this.changed(
      this.points.length,
      this.points.length === 2
        ? this.points[0].distanceTo(this.points[1])
        : null,
    );
  }
  clear() {
    this.down = null;
    this.points = [];
    this.entry = undefined;
    this.line?.geometry.dispose();
    this.line = null;
    this.group.clear();
    this.group.removeFromParent();
    this.changed(0, null);
  }
  dispose() {
    this.clear();
    this.geometry.dispose();
    this.material.dispose();
    this.lineMaterial.dispose();
    this.canvas.removeEventListener("pointerdown", this.start, true);
    this.canvas.removeEventListener("pointerup", this.pick, true);
    this.canvas.removeEventListener("pointercancel", this.cancel);
  }
}
