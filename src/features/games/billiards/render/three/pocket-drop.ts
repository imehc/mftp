import type { TableEquipment } from "../../equipment";
import {
  type PocketGeometry,
  pocketLocal,
  pocketShelfHeight,
  pocketWorld,
} from "../../pocket-geometry";
import type { SimEvent } from "../../types";

export type PocketEvent = Extract<SimEvent, { type: "pocket" }>;

function cubic(
  start: number,
  first: number,
  second: number,
  end: number,
  fraction: number,
) {
  const remaining = 1 - fraction;
  return (
    remaining ** 3 * start +
    3 * remaining ** 2 * fraction * first +
    3 * remaining * fraction ** 2 * second +
    fraction ** 3 * end
  );
}

export function pocketDropPosition(
  equipment: TableEquipment,
  pocket: PocketGeometry,
  event: PocketEvent,
  progress: number,
) {
  const start = pocketLocal(pocket.spec, event);
  const speed = Math.hypot(event.vx, event.vy);
  const lateral =
    speed > 0
      ? (-pocket.spec.dy * event.vx + pocket.spec.dx * event.vy) / speed
      : 0;
  const outward =
    speed > 0
      ? (pocket.spec.dx * event.vx + pocket.spec.dy * event.vy) / speed
      : 1;
  const distance = Math.max(0, pocket.cavityDepth - start.y);
  const approach = Math.min(1, Math.max(0, progress / 0.58));
  const drop = Math.max(0, Math.min(1, (progress - 0.58) / 0.42));
  const depth = cubic(
    start.y,
    start.y + outward * distance * 0.3,
    pocket.cavityDepth - distance * 0.15,
    pocket.cavityDepth,
    approach,
  );
  const offset = cubic(
    start.x,
    start.x + lateral * Math.min(distance * 0.25, equipment.ballRadius * 0.5),
    0,
    0,
    approach,
  );
  const point = pocketWorld(pocket.spec, offset, depth);
  return {
    x: point.x,
    z: point.y,
    y:
      equipment.ballRadius +
      pocketShelfHeight(pocket, depth) -
      (equipment.ballRadius + 0.18) * drop * drop,
    alpha: 1 - drop ** 3,
  };
}
