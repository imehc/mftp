/** 球桌几何由模拟、瞄准与渲染共同使用，单位为米。 */
import {
  BALL_RADIUS,
  CORNER_MOUTH,
  CUSHION_THICKNESS,
  JAW_RADIUS,
  POCKET_CAPTURE_SCALE,
  POCKETS,
  SIDE_MOUTH,
  TABLE_H,
  TABLE_W,
} from "./constants";

interface CushionSegment {
  /** 凸包顶点，逆时针：先内沿，后外沿，含 45° 袋口颚。 */
  profile: number[];
  points: number[];
}

export type { CushionSegment };

/** 将库边的硬折角倒圆；同一组细分顶点用于碰撞、预览和材质轮廓。 */
function roundedCushion(profile: number[]): CushionSegment {
  const points: number[] = [];
  const count = profile.length / 2;
  for (let i = 0; i < count; i++) {
    const x = profile[i * 2];
    const y = profile[i * 2 + 1];
    const previous = (i + count - 1) % count;
    const next = (i + 1) % count;
    const ax = profile[previous * 2] - x;
    const ay = profile[previous * 2 + 1] - y;
    const bx = profile[next * 2] - x;
    const by = profile[next * 2 + 1] - y;
    const al = Math.hypot(ax, ay);
    const bl = Math.hypot(bx, by);
    const inset = Math.min(JAW_RADIUS * 2, al / 3, bl / 3);
    for (let step = 0; step <= 6; step++) {
      const t = step / 6;
      points.push(
        x + (((1 - t) ** 2 * ax) / al) * inset + ((t ** 2 * bx) / bl) * inset,
        y + (((1 - t) ** 2 * ay) / al) * inset + ((t ** 2 * by) / bl) * inset,
      );
    }
  }
  return { profile, points };
}

/**
 * 六段库边（每条长边被中袋分成两段，每条短边一段）。两端切 45°，
 * 使球从袋口颚弹开而非撞上平直的墙。导出给渲染器，以绘制与物理
 * 碰撞完全一致的形状。
 */
export function cushionSegments(): CushionSegment[] {
  const t = CUSHION_THICKNESS;
  const hw = TABLE_W / 2;
  const hh = TABLE_H / 2;
  const segments: CushionSegment[] = [];

  // 长边（上 y=+hh，下 y=-hh），各在中袋处断开。
  for (const sy of [-1, 1]) {
    for (const [x0, x1] of [
      [-hw + CORNER_MOUTH, -SIDE_MOUTH],
      [SIDE_MOUTH, hw - CORNER_MOUTH],
    ]) {
      const yIn = sy * hh;
      const yOut = sy * (hh + t);
      segments.push(
        roundedCushion([x0, yIn, x1, yIn, x1 + t, yOut, x0 - t, yOut]),
      );
    }
  }
  // 短边（左 x=-hw，右 x=+hw）。
  for (const sx of [-1, 1]) {
    const xIn = sx * hw;
    const xOut = sx * (hw + t);
    const y0 = -hh + CORNER_MOUTH;
    const y1 = hh - CORNER_MOUTH;
    segments.push(
      roundedCushion([xIn, y0, xIn, y1, xOut, y1 + t, xOut, y0 - t]),
    );
  }
  return segments;
}

/** 圆形扫掠到球、袋口或库边的距离，用来截断离开方向线。 */
export function guideClearance(
  origin: { x: number; y: number },
  dir: { x: number; y: number },
  balls: readonly { id: number; x: number; y: number; potted: boolean }[],
  ignore: readonly number[],
  limit: number,
): number {
  let distance = limit;

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
  for (const pocket of POCKETS)
    circle(pocket.x, pocket.y, pocket.radius * POCKET_CAPTURE_SCALE);
  for (const { points } of cushionSegments()) {
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
