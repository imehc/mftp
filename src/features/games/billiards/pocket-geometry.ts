/** 袋颚、开孔与失去支撑边共用轮廓；圆弧/袋深为项目近似，不冒称国标模板。 */
import {
  CHINESE_EIGHT,
  createPocketSpecs,
  type PocketSettings,
  type PocketSpec,
  type TableEquipment,
} from "./equipment";

export interface Point {
  x: number;
  y: number;
}

export function pocketWorld(p: PocketSpec, u: number, v: number): Point {
  return {
    x: p.originX - p.dy * u + p.dx * v,
    y: p.originY + p.dx * u + p.dy * v,
  };
}

export function pocketLocal(p: PocketSpec, point: Point): Point {
  const x = point.x - p.originX;
  const y = point.y - p.originY;
  return { x: -p.dy * x + p.dx * y, y: p.dx * x + p.dy * y };
}

function roundJaw(
  spec: PocketSpec,
  settings: Extract<PocketSettings, { shape: "round" }>,
  equipment: TableEquipment,
) {
  const half = settings.width / 2;
  const radius = settings.jawRadius;
  const rearHalf = half + settings.rearFlare;
  const side = spec.kind === "side";
  const turnDepth = side ? radius : -half + radius * (Math.SQRT2 - 1);
  const rearDepth = side
    ? equipment.cushionWidth
    : equipment.cushionWidth * Math.SQRT2 - rearHalf;
  const startAngle = side ? -Math.PI / 2 : (-Math.PI * 3) / 4;
  const jaw: Point[] = [];
  // 最窄点精确采样，离散化不会缩小或放宽指定通道。
  for (let i = 0; i <= 24; i++) {
    const angle = startAngle + ((-Math.PI - startAngle) * i) / 24;
    jaw.push({
      x: half + radius + Math.cos(angle) * radius,
      y: turnDepth + Math.sin(angle) * radius,
    });
  }
  for (let i = 1; i <= 16; i++) {
    const t = i / 16;
    jaw.push({
      x: half + settings.rearFlare * t * t,
      y: turnDepth + (rearDepth - turnDepth) * t,
    });
  }
  return {
    jaw,
    rearHalf,
    turnDepth,
    rearDepth,
    supportDepth: settings.supportDepth,
  };
}

function cutJaw(
  spec: PocketSpec,
  settings: Extract<PocketSettings, { shape: "cut" }>,
  equipment: TableEquipment,
) {
  const half = settings.width / 2;
  const side = spec.kind === "side";
  const turnDepth = side ? 0 : -half;
  // 水平切角以对应库鼻方向为基准；转换为袋口局部轴上的收口斜率。
  const slope = Math.tan(
    ((settings.cutAngle - (side ? 90 : 135)) * Math.PI) / 180,
  );
  const rearDepth = side
    ? equipment.cushionWidth
    : (equipment.cushionWidth * Math.SQRT2) / (1 - slope) - half;
  const rearHalf = half - (rearDepth - turnDepth) * slope;
  const jaw = [
    { x: half, y: turnDepth },
    { x: rearHalf, y: rearDepth },
  ];
  return {
    jaw,
    rearHalf,
    turnDepth,
    rearDepth,
    supportDepth: turnDepth + settings.shelf,
  };
}

function buildPocket(spec: PocketSpec, equipment: TableEquipment) {
  const settings = equipment[spec.kind];
  const { jaw, rearHalf, turnDepth, rearDepth, supportDepth } =
    settings.shape === "round"
      ? roundJaw(spec, settings, equipment)
      : cutJaw(spec, settings, equipment);
  const right = jaw.map(({ x, y }) => pocketWorld(spec, x, y));
  const left = jaw.map(({ x, y }) => pocketWorld(spec, -x, y));
  // 开孔前缘位于支撑判定线前30mm，母球开始下沉时不会突然裁掉半个球。
  const front = Math.max(jaw[0].y, supportDepth - 0.03);
  const openingSide: Point[] = jaw[0].y >= front ? [jaw[0]] : [];
  for (let i = 1; i < jaw.length; i++) {
    const a = jaw[i - 1];
    const b = jaw[i];
    if (a.y < front && b.y >= front) {
      const t = (front - a.y) / (b.y - a.y);
      openingSide.push({ x: a.x + (b.x - a.x) * t, y: front });
    }
    if (b.y >= front) openingSide.push(b);
  }
  const back: Point[] = [];
  for (let i = 0; i <= 40; i++) {
    const angle = (i / 40) * Math.PI;
    back.push({
      x: rearHalf * Math.cos(angle),
      y: rearDepth + rearHalf * Math.sin(angle),
    });
  }
  const openingLocal = [
    ...openingSide,
    ...back.slice(1),
    ...openingSide
      .slice(0, -1)
      .reverse()
      .map(({ x, y }) => ({ x: -x, y })),
  ];
  const opening = openingLocal.map(({ x, y }) => pocketWorld(spec, x, y));
  return {
    spec,
    width: settings.width,
    turnDepth,
    rearDepth,
    rearHalf,
    supportDepth,
    front,
    left,
    right,
    opening,
    openingLocal,
    back: back.map(({ x, y }) => pocketWorld(spec, x, y)),
  };
}

export type PocketGeometry = ReturnType<typeof buildPocket>;

const cache = new WeakMap<TableEquipment, readonly PocketGeometry[]>();

export function getPocketGeometries(
  equipment: TableEquipment = CHINESE_EIGHT,
): readonly PocketGeometry[] {
  let pockets = cache.get(equipment);
  if (!pockets) {
    pockets = createPocketSpecs(equipment).map((spec) =>
      buildPocket(spec, equipment),
    );
    cache.set(equipment, pockets);
  }
  return pockets;
}

/** 旧中式调用的兼容入口，新代码传入器材配置。 */
export const POCKET_GEOMETRIES = getPocketGeometries();

export function insidePolygon(point: Point, points: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

/** 球心须进入实际开孔并越过支撑线；不以贴图半径放大吸球区。 */
export function pocketAt(
  point: Point,
  equipment: TableEquipment = CHINESE_EIGHT,
): PocketSpec | undefined {
  return getPocketGeometries(equipment).find((p) => {
    const local = pocketLocal(p.spec, point);
    return (
      local.y >= p.supportDepth &&
      local.y <= p.rearDepth + p.rearHalf &&
      Math.abs(local.x) <= p.rearHalf &&
      insidePolygon(local, p.openingLocal)
    );
  })?.spec;
}

/** 辅助线在与正式模拟相同的支撑边结束。 */
export function pocketRayDistance(
  origin: Point,
  dir: Point,
  limit: number,
  equipment: TableEquipment = CHINESE_EIGHT,
): number {
  let nearest = limit;
  for (const p of getPocketGeometries(equipment)) {
    const local = pocketLocal(p.spec, origin);
    const speed = dir.x * p.spec.dx + dir.y * p.spec.dy;
    if (speed <= 1e-9) continue;
    const distance = (p.supportDepth - local.y) / speed;
    if (distance < 0 || distance >= nearest) continue;
    const at = {
      x: origin.x + distance * dir.x,
      y: origin.y + distance * dir.y,
    };
    if (insidePolygon(at, p.opening)) nearest = distance;
  }
  return nearest;
}
