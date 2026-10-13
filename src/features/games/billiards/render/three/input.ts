import { type Camera, Plane, Raycaster, Vector2, Vector3 } from "three";

import { unlockAudio } from "../audio";

export function createTableInput(
  canvas: HTMLCanvasElement,
  camera: Camera,
  handlers: {
    enabled(): boolean;
    down(point: { x: number; y: number }): void;
    move(point: { x: number; y: number }): void;
    up(point: { x: number; y: number }): void;
    cancel(): void;
  },
) {
  const ray = new Raycaster();
  const ndc = new Vector2();
  const hit = new Vector3();
  const plane = new Plane(new Vector3(0, 1, 0), 0);
  let active: number | null = null;

  const point = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((e.clientY - rect.top) / rect.height) * 2,
    );
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.z } : null;
  };

  const release = () => {
    const pointer = active;
    active = null;
    if (pointer !== null && canvas.hasPointerCapture(pointer))
      canvas.releasePointerCapture(pointer);
  };

  const cancel = () => {
    if (active === null) return;
    release();
    handlers.cancel();
  };

  const down = (e: PointerEvent) => {
    unlockAudio();
    if (
      !handlers.enabled() ||
      active !== null ||
      (e.pointerType === "mouse" && e.button !== 0)
    )
      return;
    const p = point(e);
    if (!p) return;
    active = e.pointerId;
    canvas.setPointerCapture(active);
    handlers.down(p);
  };

  const move = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    if (!handlers.enabled()) {
      cancel();
      return;
    }
    const p = point(e);
    if (p) handlers.move(p);
  };

  const up = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    const p = point(e);
    release();
    if (p && handlers.enabled()) handlers.up(p);
    else handlers.cancel();
  };

  const lost = (e: PointerEvent) => {
    if (e.pointerId === active) cancel();
  };

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", lost);
  canvas.addEventListener("lostpointercapture", lost);
  window.addEventListener("blur", cancel);
  return {
    cancel,
    dispose() {
      cancel();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", lost);
      canvas.removeEventListener("lostpointercapture", lost);
      window.removeEventListener("blur", cancel);
    },
  };
}
