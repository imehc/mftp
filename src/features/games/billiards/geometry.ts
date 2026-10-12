/** 球桌几何由模拟、瞄准与渲染共同使用，单位为米。 */
import { CHINESE_EIGHT, type TableEquipment } from "./equipment";
import type { Point } from "./pocket-geometry";
import { getPocketGeometries, pocketRayDistance } from "./pocket-geometry";

export interface CushionSegment {
  /** 内沿起点、终点、袋颚后端；用于库面明暗与标记，不另造碰撞轮廓。 */
  profile: number[];
  points: number[];
  jaws: Point[][];
}

const flat = (points: readonly Point[]) => points.flatMap(({ x, y }) => [x, y]);

function railJaws(
  axis: "x" | "y",
  value: number,
  equipment: TableEquipment,
): Point[][] {
  const along = axis === "x" ? "y" : "x";
  return getPocketGeometries(equipment)
    .flatMap((p) => [p.left, p.right])
    .filter((jaw) => Math.abs(jaw[0][axis] - value) < 1e-8)
    .sort((a, b) => a[0][along] - b[0][along]);
}

/** 从相邻袋口的真实曲线闭合库边，避免六段独立圆角与洞口拼接。 */
function rail(a: Point[], b: Point[]): CushionSegment {
  return {
    profile: flat([a[0], b[0], b[b.length - 1], a[a.length - 1]]),
    points: flat([...a].reverse().concat(b)),
    jaws: [a, b],
  };
}

const cushionCache = new WeakMap<TableEquipment, readonly CushionSegment[]>();

export function cushionSegments(
  equipment: TableEquipment = CHINESE_EIGHT,
): readonly CushionSegment[] {
  const cached = cushionCache.get(equipment);
  if (cached) return cached;
  const cushions: CushionSegment[] = [];
  for (const sy of [-1, 1]) {
    const ends = railJaws("y", (sy * equipment.tableHeight) / 2, equipment);
    cushions.push(rail(ends[0], ends[1]), rail(ends[2], ends[3]));
  }
  for (const sx of [-1, 1]) {
    const ends = railJaws("x", (sx * equipment.tableWidth) / 2, equipment);
    cushions.push(rail(ends[0], ends[1]));
  }
  cushionCache.set(equipment, cushions);
  return cushions;
}

/** 圆形扫掠到球、袋口或库边的距离，用来截断离开方向线。 */
export function guideClearance(
  origin: { x: number; y: number },
  dir: { x: number; y: number },
  balls: readonly { id: number; x: number; y: number; potted: boolean }[],
  ignore: readonly number[],
  limit: number,
  equipment: TableEquipment = CHINESE_EIGHT,
): number {
  const BALL_RADIUS = equipment.ballRadius;
  let distance = pocketRayDistance(origin, dir, limit, equipment);

  const circle = (x: number, y: number, radius: number) => {
    const dx = x - origin.x;
    const dy = y - origin.y;
    const projection = dx * dir.x + dy * dir.y;
    const cross = dx * dir.y - dy * dir.x;
    const discriminant = radius * radius - cross * cross;
    if (discriminant < 0) return;
    const hit = projection - Math.sqrt(discriminant);
    if (hit >= 0) distance = Math.min(distance, hit);
  };

  for (const ball of balls) {
    if (!ball.potted && !ignore.includes(ball.id))
      circle(ball.x, ball.y, BALL_RADIUS * 2);
  }
  for (const { points } of cushionSegments(equipment)) {
    for (let i = 0; i < points.length; i += 2) {
      const ax = points[i];
      const ay = points[i + 1];
      const bx = points[(i + 2) % points.length];
      const by = points[(i + 3) % points.length];
      const length = Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay) / length;
      const ny = (bx - ax) / length;
      const speed = dir.x * nx + dir.y * ny;
      if (Math.abs(speed) < 1e-9) continue;
      for (const sign of [-1, 1]) {
        const hit =
          (sign * BALL_RADIUS - ((origin.x - ax) * nx + (origin.y - ay) * ny)) /
          speed;
        const projection =
          ((origin.x + dir.x * hit - ax) * (bx - ax) +
            (origin.y + dir.y * hit - ay) * (by - ay)) /
          length;
        if (hit >= 0 && projection >= 0 && projection <= length)
          distance = Math.min(distance, hit);
      }
      circle(ax, ay, BALL_RADIUS);
    }
  }
  return distance;
}
