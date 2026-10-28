import { Vector2, Vector3 } from "three";

import { faceMove } from "../engine";
import {
  type Axis,
  type CubeMove,
  type CubeOrder,
  type Face,
  FACES,
} from "../types";
import type { CubeScene } from "./scene";

export interface CubeInputOptions {
  enabled(): boolean;
  busy(): boolean;
  observe(): boolean;
  order(): CubeOrder;
  turn(move: CubeMove): void;
}

export function installCubeInput(scene: CubeScene, options: CubeInputOptions) {
  const canvas = scene.canvas;
  const pointers = new Map<number, Vector2>();
  const origin = new Vector2();
  const last = new Vector2();
  let hit: ReturnType<CubeScene["pick"]> = null;
  let move: CubeMove | null = null;
  let tangent = new Vector2();
  let angle = 0;
  let pinchDistance = 0;
  let pinching = false;

  function cancel(): void {
    for (const id of pointers.keys())
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    pointers.clear();
    hit = null;
    move = null;
    angle = 0;
    pinching = false;
    scene.cancel();
    canvas.style.cursor = "grab";
  }

  function down(event: PointerEvent): void {
    if (!options.enabled() || options.busy() || event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, new Vector2(event.clientX, event.clientY));
    if (pointers.size > 1) {
      scene.cancel();
      hit = null;
      move = null;
      const [a, b] = [...pointers.values()];
      pinchDistance = a.distanceTo(b);
      pinching = true;
      return;
    }
    origin.set(event.clientX, event.clientY);
    last.copy(origin);
    hit = options.observe() ? null : scene.pick(event.clientX, event.clientY);
    canvas.style.cursor = "grabbing";
  }

  function moving(event: PointerEvent): void {
    if (!options.enabled()) {
      if (pointers.size) cancel();
      return;
    }
    if (!pointers.has(event.pointerId)) {
      canvas.style.cursor =
        !options.observe() &&
        !options.busy() &&
        scene.pick(event.clientX, event.clientY)
          ? "pointer"
          : "grab";
      return;
    }
    const point = new Vector2(event.clientX, event.clientY);
    pointers.set(event.pointerId, point);
    if (pinching) {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const distance = a.distanceTo(b);
      if (distance > 0 && pinchDistance > 0)
        scene.zoom(pinchDistance / distance);
      pinchDistance = distance;
      return;
    }
    if (!hit) {
      scene.orbit(point.x - last.x, point.y - last.y);
      last.copy(point);
      return;
    }
    const delta = point.clone().sub(origin);
    if (!move && delta.length() < 9) return;
    if (!move) {
      let best = -1;
      for (const axis of [0, 1, 2] as Axis[]) {
        if (hit.normal[axis]) continue;
        const direction = new Vector3().setComponent(axis, 1).cross(hit.point);
        const projected = scene
          .project(hit.point.clone().addScaledVector(direction, 0.1))
          .sub(scene.project(hit.point))
          .normalize();
        const score = Math.abs(projected.dot(delta.clone().normalize()));
        if (score > best) {
          best = score;
          tangent = projected;
          move = { axis, layer: hit.position[axis], turns: 1 };
        }
      }
    }
    if (!move) return;
    angle = Math.max(
      -Math.PI,
      Math.min(
        Math.PI,
        ((delta.dot(tangent) /
          Math.max(
            80,
            Math.min(canvas.clientWidth, canvas.clientHeight) * 0.24,
          )) *
          Math.PI) /
          2,
      ),
    );
    scene.preview(move, angle);
  }

  function up(event: PointerEvent): void {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    if (pinching) {
      if (!pointers.size) cancel();
      return;
    }
    const current = move;
    move = null;
    hit = null;
    if (current && Math.abs(angle) >= 0.28) {
      const steps = Math.max(
        1,
        Math.min(2, Math.round(Math.abs(angle) / (Math.PI / 2))),
      );
      options.turn({ ...current, turns: steps === 2 ? 2 : angle > 0 ? 1 : -1 });
    } else scene.cancel();
    angle = 0;
    canvas.style.cursor = "grab";
  }

  function wheel(event: WheelEvent): void {
    if (!options.enabled()) return;
    event.preventDefault();
    scene.zoom(Math.exp(event.deltaY * 0.001));
  }

  function key(event: KeyboardEvent): void {
    if (!options.enabled() || event.ctrlKey || event.metaKey || event.altKey)
      return;
    if (event.key === "Escape") {
      cancel();
      return;
    }
    if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      scene.orbit(
        event.key === "ArrowLeft" ? -15 : event.key === "ArrowRight" ? 15 : 0,
        event.key === "ArrowUp" ? 15 : event.key === "ArrowDown" ? -15 : 0,
      );
      return;
    }
    const face = event.key.toUpperCase() as Face;
    if (FACES.includes(face)) {
      event.preventDefault();
      options.turn(faceMove(face, 1, !event.shiftKey, options.order()));
    }
  }

  const interrupted = () => cancel();

  const lostCapture = (event: PointerEvent) => {
    if (pointers.has(event.pointerId)) cancel();
  };

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", moving);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", interrupted);
  canvas.addEventListener("lostpointercapture", lostCapture);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("keydown", key);
  window.addEventListener("blur", interrupted);
  return {
    cancel,
    dispose() {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", moving);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", interrupted);
      canvas.removeEventListener("lostpointercapture", lostCapture);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("keydown", key);
      window.removeEventListener("blur", interrupted);
      cancel();
    },
  };
}
