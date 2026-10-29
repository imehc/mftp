import { type Camera, Plane, Raycaster, Vector2, Vector3 } from "three";

import { unlockAudio } from "../audio";

export function createTableInput(
  surface: HTMLElement,
  camera: Camera,
  handlers: {
    enabled(): boolean;
    down(point: { x: number; y: number }): void;
    move(point: { x: number; y: number }): void;
    up(point: { x: number; y: number }): void;
    cancel(): void;
    outsideHit?(event: PointerEvent, bounds: DOMRect): boolean;
  },
) {
  const ray = new Raycaster();
  const ndc = new Vector2();
  const hit = new Vector3();
  const plane = new Plane(new Vector3(0, 1, 0), 0);
  let active: number | null = null;

  const point = (e: PointerEvent) => {
    const rect = surface.getBoundingClientRect();
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
    if (handlers.outsideHit)
      document.removeEventListener("touchmove", preventScroll);
    if (pointer !== null && surface.hasPointerCapture(pointer))
      surface.releasePointerCapture(pointer);
  };

  const preventScroll = (event: TouchEvent) => {
    if (active !== null) event.preventDefault();
  };

  const cancel = () => {
    if (active === null) return;
    release();
    handlers.cancel();
  };

  // 手势归属由 BilliardsStage 外层 touch-none 承担；这里只过滤鼠标非主键，
  // 触摸由 pointer capture 独占，避免拖杆时页面滚动。
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
    // div 输入面与球桌外球杆都不能启动浏览器文字选择或原生拖放。
    e.preventDefault();
    active = e.pointerId;
    surface.setPointerCapture(active);
    handlers.down(p);
  };

  const outsideDown = (event: PointerEvent) => {
    if (event.defaultPrevented || active !== null || !handlers.enabled())
      return;
    const path = event.composedPath();
    if (path.includes(surface)) return;
    // 控件始终优先；只接管非控件区域中可见球杆的窄命中范围。
    if (
      path.some(
        (node) =>
          node instanceof Element &&
          node.matches(
            'a, button, input, textarea, select, label, summary, [tabindex], [role="button"], [role="slider"], [role="switch"], [role="combobox"], [role="menuitem"], [contenteditable]:not([contenteditable="false"]), [data-slot="slider"]',
          ),
      )
    )
      return;
    if (!handlers.outsideHit?.(event, surface.getBoundingClientRect())) return;
    down(event);
    if (active !== null && event.pointerType === "touch")
      document.addEventListener("touchmove", preventScroll, { passive: false });
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

  surface.addEventListener("pointerdown", down);
  surface.addEventListener("pointermove", move);
  surface.addEventListener("pointerup", up);
  surface.addEventListener("pointercancel", lost);
  surface.addEventListener("lostpointercapture", lost);
  window.addEventListener("blur", cancel);
  if (handlers.outsideHit)
    document.addEventListener("pointerdown", outsideDown);
  return {
    cancel,
    dispose() {
      cancel();
      surface.removeEventListener("pointerdown", down);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", up);
      surface.removeEventListener("pointercancel", lost);
      surface.removeEventListener("lostpointercapture", lost);
      window.removeEventListener("blur", cancel);
      if (handlers.outsideHit)
        document.removeEventListener("pointerdown", outsideDown);
    },
  };
}
