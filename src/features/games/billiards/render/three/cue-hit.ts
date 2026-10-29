import { type Camera, type Object3D, Vector3 } from "three";

/** 用实际球杆的投影判断命中，避开抬杆高度与屏幕旋转带来的平面误差。 */
export function createCueHitTest(stick: Object3D, length: number) {
  const tip = new Vector3();
  const butt = new Vector3();
  return (
    event: Pick<PointerEvent, "clientX" | "clientY" | "pointerType">,
    camera: Camera,
    bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  ) => {
    stick.updateWorldMatrix(true, false);
    tip.set(0, 0, 0).applyMatrix4(stick.matrixWorld).project(camera);
    butt.set(length, 0, 0).applyMatrix4(stick.matrixWorld).project(camera);
    if (Math.abs(tip.z) > 1 || Math.abs(butt.z) > 1) return false;
    const ax = bounds.left + ((tip.x + 1) * bounds.width) / 2;
    const ay = bounds.top + ((1 - tip.y) * bounds.height) / 2;
    const dx = ((butt.x - tip.x) * bounds.width) / 2;
    const dy = ((tip.y - butt.y) * bounds.height) / 2;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < 1) return false;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((event.clientX - ax) * dx + (event.clientY - ay) * dy) /
          distanceSquared,
      ),
    );
    return (
      Math.hypot(event.clientX - ax - t * dx, event.clientY - ay - t * dy) <=
      (event.pointerType === "touch" ? 22 : 8)
    );
  };
}
