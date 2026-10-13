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
  // 当前中式桌按用户要求使用直切入口，净宽仍取最窄截面；碰撞与可见袋颚共用。
  if (equipment.id === "chinese-eight") {
    const side = spec.kind === "side";
    const rearHalf = half;
    const rearDepth = side
      ? equipment.cushionWidth
      : equipment.cushionWidth * Math.SQRT2 - half;
    const turnDepth = side ? settings.supportDepth : -half;
    const jaw = side
      ? [
          { x: half + turnDepth * Math.tan((35 * Math.PI) / 180), y: 0 },
          { x: half, y: turnDepth },
          { x: half, y: rearDepth },
        ]
      : [
          { x: half, y: turnDepth },
          { x: half, y: rearDepth },
        ];
    return {
      jaw,
      rearHalf,
      rearDepth,
      turnDepth,
      supportDepth: settings.supportDepth,
    };
  }
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
  // 中式桌与九球沿真实直切颚面包呢；斯诺克保留该器材的圆颚轮廓。
  const facingJaw = jaw;
  const facingRearHalf = facingJaw[facingJaw.length - 1].x;
  const facingRight = facingJaw.map(({ x, y }) => pocketWorld(spec, x, y));
  const facingLeft = facingJaw.map(({ x, y }) => pocketWorld(spec, -x, y));
  const right = jaw.map(({ x, y }) => pocketWorld(spec, x, y));
  const left = jaw.map(({ x, y }) => pocketWorld(spec, -x, y));
  // 袋孔沿袋颚后方承接台呢，位置随真实支撑边与开口大小变化。
  const originalFront = Math.max(jaw[0].y, supportDepth - 0.024);
  // 圆颚中袋的袋腔直径随净宽定位，避免后侧包边挤到木框外沿。
  const cavityRadius =
    spec.kind === "side"
      ? settings.shape === "round"
        ? settings.width / 2
        : rearHalf
      : equipment.id === "chinese-eight"
        ? settings.width * 0.55
        : Math.max(rearHalf * 0.94, equipment.ballRadius * 1.4);
  // 三种参考桌均把孔心放在库背，四角的对角轴投影与中袋齐线。
  const alignedDepth = equipment.cushionWidth;
  const cavityDepth =
    spec.kind === "side" ? alignedDepth : alignedDepth * Math.SQRT2;
  const front = Math.min(originalFront, cavityDepth - cavityRadius - 0.006);
  const border = equipment.cushionWidth + equipment.frameWidth;
  const outsideClearance =
    border -
    Math.max(Math.abs(spec.dx), Math.abs(spec.dy)) * cavityDepth -
    cavityRadius;
  const rimWidth = Math.min(0.014, outsideClearance * 0.8);
  // 只在支撑线前收圆台呢切口；袋颚净宽与进入支撑线后的捕获区域不变。
  const roundingDepth = Math.min(
    (supportDepth - front) * 0.95,
    settings.width * 0.35,
    rearDepth - front,
  );
  const lipDepth = front + roundingDepth;
  const openingSide: Point[] = facingJaw[0].y >= lipDepth ? [facingJaw[0]] : [];
  for (let i = 1; i < facingJaw.length; i++) {
    const a = facingJaw[i - 1];
    const b = facingJaw[i];
    if (a.y < lipDepth && b.y >= lipDepth) {
      const t = (lipDepth - a.y) / (b.y - a.y);
      openingSide.push({ x: a.x + (b.x - a.x) * t, y: lipDepth });
    }
    if (b.y >= lipDepth) openingSide.push(b);
  }
  const captureBack: Point[] = [];
  for (let i = 0; i <= 40; i++) {
    const angle = (i / 40) * Math.PI;
    captureBack.push({
      x: rearHalf * Math.cos(angle),
      y: rearDepth + rearHalf * Math.sin(angle),
    });
  }
  const shoulder: Point[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    shoulder.push({
      x: cavityRadius + (facingRearHalf - cavityRadius) * (1 - t) ** 2,
      y: rearDepth + (cavityDepth - rearDepth) * t,
    });
  }
  const backPoints: Point[] = [...shoulder];
  for (let i = 1; i <= 96; i++) {
    const angle = (i / 96) * Math.PI;
    backPoints.push({
      x: cavityRadius * Math.cos(angle),
      y: cavityDepth + cavityRadius * Math.sin(angle),
    });
  }
  backPoints.push(
    ...shoulder
      .slice(0, -1)
      .reverse()
      .map(({ x, y }) => ({ x: -x, y })),
  );
  // 孔心与库背齐平时肩部会退化为一个点；移除重复点，避免零长度法线。
  const back = backPoints.filter(
    (point, i) =>
      i === 0 ||
      Math.hypot(point.x - backPoints[i - 1].x, point.y - backPoints[i - 1].y) >
        1e-9,
  );
  // 捕获区域保留原支撑线与后弧；衬里后移只增加下沉后的容纳空间。
  const captureLocal = [
    ...jaw,
    ...captureBack.slice(1),
    ...jaw
      .slice(0, -1)
      .reverse()
      .map(({ x, y }) => ({ x: -x, y })),
  ];
  const entryLocal = [
    ...openingSide,
    ...back.slice(1),
    ...openingSide
      .slice(0, -1)
      .reverse()
      .map(({ x, y }) => ({ x: -x, y })),
  ];
  for (let i = 1; i < 32; i++) {
    const angle = Math.PI + (i / 32) * Math.PI;
    entryLocal.push({
      x: openingSide[0].x * Math.cos(angle),
      y: lipDepth + roundingDepth * Math.sin(angle),
    });
  }
  const openingLocal = Array.from({ length: 128 }, (_, i) => {
    const angle = (i / 128) * Math.PI * 2;
    return {
      x: cavityRadius * Math.cos(angle),
      y: cavityDepth + cavityRadius * Math.sin(angle),
    };
  });
  const opening = openingLocal.map(({ x, y }) => pocketWorld(spec, x, y));
  const shelfLocal = [...openingSide, ...shoulder.slice(1)];
  for (let step = 1; step <= 64; step++) {
    const angle = -(step / 64) * Math.PI;
    shelfLocal.push({
      x: cavityRadius * Math.cos(angle),
      y: cavityDepth + cavityRadius * Math.sin(angle),
    });
  }
  shelfLocal.push(
    ...shoulder
      .slice(0, -1)
      .reverse()
      .map(({ x, y }) => ({ x: -x, y })),
    ...openingSide
      .slice(0, -1)
      .reverse()
      .map(({ x, y }) => ({ x: -x, y })),
    ...entryLocal.slice(-31),
  );
  return {
    spec,
    width: settings.width,
    turnDepth,
    rearDepth,
    cavityDepth,
    cavityRadius,
    rimWidth,
    rearHalf,
    facingRearHalf,
    facingLeft,
    facingRight,
    supportDepth,
    front: cavityDepth - cavityRadius,
    entryFront: front,
    entryLocal,
    shelfLocal,
    left,
    right,
    opening,
    openingLocal,
    captureLocal,
    back: back.map(({ x, y }) => pocketWorld(spec, x, y)),
    backNormals: back.map((_, i) => {
      const before = back[Math.max(0, i - 1)];
      const after = back[Math.min(back.length - 1, i + 1)];
      const length = Math.hypot(after.x - before.x, after.y - before.y);
      const u = (after.y - before.y) / length;
      const v = (before.x - after.x) / length;
      return { x: -spec.dy * u + spec.dx * v, y: spec.dx * u + spec.dy * v };
    }),
  };
}

export function pocketShelfHeight(pocket: PocketGeometry, depth: number) {
  const fraction = Math.max(
    0,
    Math.min(
      1,
      (depth - pocket.entryFront) / (pocket.front - pocket.entryFront),
    ),
  );
  return -0.003 * fraction * fraction * (3 - 2 * fraction);
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
      insidePolygon(local, p.captureLocal)
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
    if (insidePolygon(pocketLocal(p.spec, at), p.captureLocal))
      nearest = distance;
  }
  return nearest;
}
