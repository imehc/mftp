import {
  BufferGeometry,
  Float32BufferAttribute,
  ShapeUtils,
  Vector2,
} from "three";

import type { CushionSegment } from "../../geometry";

/** 凸形库边向内部偏移；连接两袋颚后端的库背不缩进，保持与木框齐接。 */
function insetRing(points: Vector2[], distance: number, frontEdge: number) {
  const winding = ShapeUtils.isClockWise(points) ? -1 : 1;
  const lines = points.map((point, i) => {
    const next = points[(i + 1) % points.length];
    const direction = next.clone().sub(point).normalize();
    const normal = new Vector2(-direction.y, direction.x).multiplyScalar(
      winding,
    );
    return {
      point: point
        .clone()
        .addScaledVector(normal, i === points.length - 1 ? 0 : distance),
      direction,
    };
  });
  const ring = lines.map((line, i) => {
    const previous = lines[(i + lines.length - 1) % lines.length];
    const cross = previous.direction.cross(line.direction);
    if (Math.abs(cross) < 1e-9) return line.point;
    const t =
      line.point.clone().sub(previous.point).cross(line.direction) / cross;
    return previous.point.clone().addScaledVector(previous.direction, t);
  });
  // 曲线偏移到库背附近时限于接缝内侧，避免回折穿过木框形成细小尖角。
  const back = lines[lines.length - 1];
  const backNormal = new Vector2(
    -back.direction.y,
    back.direction.x,
  ).multiplyScalar(winding);
  const front = lines[frontEdge];
  const frontNormal = new Vector2(
    -front.direction.y,
    front.direction.x,
  ).multiplyScalar(winding);
  return ring.map((point, i) => {
    // 斜切边含密集采样点，偏移后超出台面边的点收在真实交点，防止绕回自交。
    if (point.clone().sub(front.point).dot(frontNormal) < -1e-9)
      return ring[i <= frontEdge ? frontEdge : frontEdge + 1].clone();
    const clearance = point.clone().sub(back.point).dot(backNormal);
    return clearance < 0
      ? point.addScaledVector(backNormal, -clearance)
      : point;
  });
}

/** 库鼻在球心下方保持原碰撞边界，上方逐层退让形成包呢斜面。 */
export function createCushionGeometry(segment: CushionSegment, top: number) {
  const points: Vector2[] = [];
  for (let i = 0; i < segment.points.length; i += 2)
    points.push(new Vector2(segment.points[i], segment.points[i + 1]));
  const facings: Vector2[] = [];
  for (let i = 0; i < segment.facingPoints.length; i += 2)
    facings.push(
      new Vector2(segment.facingPoints[i], segment.facingPoints[i + 1]),
    );
  const profile = [
    [0.009, 0.003],
    [0.002, top * 0.34],
    [0, top * 0.46],
    [0.0005, top * 0.57],
    [0.0035, top * 0.7],
    [0.0095, top * 0.88],
    [0.016, top * 0.98],
    [0.017, top],
    [0.018, top],
  ];
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const count = points.length;
  const clockwise = ShapeUtils.isClockWise(points);
  let upper = points;

  const triangle = (a: number, b: number, c: number) => {
    indices.push(...(clockwise ? [c, b, a] : [a, b, c]));
  };

  for (let layer = 0; layer < profile.length; layer++) {
    const [inset, height] = profile[layer];
    // 球心以下保留真实库鼻，上方包呢平顺过渡到袋后轮廓。
    const blend = Math.max(0, Math.min(1, (height / top - 0.46) / 0.24));
    upper = insetRing(
      points.map((point, i) => point.clone().lerp(facings[i], blend)),
      inset,
      segment.jaws[0].length - 1,
    );
    upper.forEach((point, i) => {
      vertices.push(point.x, height, point.y);
      uvs.push(point.x, -point.y);
      if (layer === 0) return;
      const a = (layer - 1) * count + i;
      const b = (layer - 1) * count + ((i + 1) % count);
      const c = layer * count + ((i + 1) % count);
      const d = layer * count + i;
      triangle(a, c, b);
      triangle(a, d, c);
    });
  }
  // 剖面逐渐放平后与顶面共用顶点，消除包呢斜面上的硬折线。
  const topStart = (profile.length - 1) * count;
  for (const [a, b, c] of ShapeUtils.triangulateShape(upper, []))
    indices.push(topStart + c, topStart + b, topStart + a);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
