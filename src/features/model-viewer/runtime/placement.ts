import {
  Plane,
  Raycaster,
  Vector2,
  Vector3,
  type PerspectiveCamera,
} from "three";
import type { ModelCollection, ModelEntry } from "./collection";

/** 显式摆放模式独占指针；平面沿视线，数值输入提供所有轴的等价操作。 */
export class ModelPlacement {
  enabled = false;
  private ray = new Raycaster();
  private plane = new Plane();
  private offset = new Vector3();
  private drag: {
    pointer: number;
    entry: ModelEntry;
    initial: Vector3;
  } | null = null;
  constructor(
    private canvas: HTMLCanvasElement,
    private camera: PerspectiveCamera,
    private models: ModelCollection,
    private changed: () => void,
  ) {
    canvas.addEventListener("pointerdown", this.down, true);
    canvas.addEventListener("pointermove", this.move, true);
    canvas.addEventListener("pointerup", this.up, true);
    canvas.addEventListener("pointercancel", this.cancel, true);
    canvas.addEventListener("lostpointercapture", this.cancel, true);
  }
  private cast(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(
      new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
  }
  private down = (event: PointerEvent) => {
    if (!this.enabled || this.drag || event.button !== 0) return;
    this.cast(event);
    const layers = [...this.models.entries.values()].filter(
      (e) => e.layer.visible,
    );
    const hit = this.ray.intersectObjects(
      layers.map((e) => e.layer),
      true,
    )[0];
    if (!hit) return;
    const entry = layers.find((e) => {
      let node = hit.object;
      while (node.parent && node !== e.layer) node = node.parent;
      return node === e.layer;
    });
    if (!entry) return;
    this.models.selected = entry.id;
    this.plane.setFromNormalAndCoplanarPoint(
      this.camera.getWorldDirection(new Vector3()),
      hit.point,
    );
    this.offset.copy(hit.point).sub(entry.layer.position);
    this.drag = {
      pointer: event.pointerId,
      entry,
      initial: entry.layer.position.clone(),
    };
    this.canvas.setPointerCapture(event.pointerId);
    event.stopImmediatePropagation();
    event.preventDefault();
    this.changed();
  };
  private move = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointer) return;
    this.cast(event);
    const position = this.ray.ray.intersectPlane(this.plane, new Vector3());
    if (position)
      this.models.move(this.drag.entry.id, position.sub(this.offset).toArray());
    event.stopImmediatePropagation();
  };
  private finish(revert: boolean) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (revert) this.models.move(drag.entry.id, drag.initial.toArray());
    if (this.canvas.hasPointerCapture(drag.pointer))
      this.canvas.releasePointerCapture(drag.pointer);
    this.changed();
  }
  private up = (event: PointerEvent) => {
    if (event.pointerId === this.drag?.pointer) {
      this.finish(false);
      event.stopImmediatePropagation();
    }
  };
  cancel = () => this.finish(true);
  dispose() {
    this.cancel();
    this.canvas.removeEventListener("pointerdown", this.down, true);
    this.canvas.removeEventListener("pointermove", this.move, true);
    this.canvas.removeEventListener("pointerup", this.up, true);
    this.canvas.removeEventListener("pointercancel", this.cancel, true);
    this.canvas.removeEventListener("lostpointercapture", this.cancel, true);
  }
}
