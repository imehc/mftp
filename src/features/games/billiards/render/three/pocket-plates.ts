import { ExtrudeGeometry, Shape, Vector2 } from "three";

import type { TableEquipment } from "../../equipment";
import type { PocketGeometry } from "../../pocket-geometry";
import { tableLayout } from "../layout";

/** 金属护角沿木框外圆角闭合，内沿接袋口压边，留出整个进球通道。 */
export function createCornerPocketPlate(
  pocket: PocketGeometry,
  equipment: TableEquipment,
  top: number,
) {
  const { spec } = pocket;
  const sx = Math.sign(spec.dx);
  const sy = Math.sign(spec.dy);
  const border = equipment.cushionWidth + equipment.frameWidth;
  const radius = tableLayout(equipment).CORNER_RADIUS;
  const points = pocket.back.map((point, i) => {
    const normal = pocket.backNormals[i];
    return new Vector2(
      sx * (point.x + normal.x * pocket.rimWidth - spec.originX),
      sy * (point.y + normal.y * pocket.rimWidth - spec.originY),
    );
  });
  // 两种镜像角袋统一沿局部转角的顺时针方向接外轮廓。
  if (points[0].x > points[points.length - 1].x) points.reverse();
  const first = points[0];
  const last = points[points.length - 1];
  points.push(new Vector2(border, last.y));
  for (let step = 0; step <= 24; step++) {
    const angle = ((step / 24) * Math.PI) / 2;
    points.push(
      new Vector2(
        border - radius + radius * Math.cos(angle),
        border - radius + radius * Math.sin(angle),
      ),
    );
  }
  points.push(new Vector2(first.x, border));
  const world = points.map(
    (point) =>
      new Vector2(spec.originX + sx * point.x, -(spec.originY + sy * point.y)),
  );
  return extrudePlate(world, top);
}

/** 中袋金属片横跨木框，内沿随袋后半圆挖空。 */
export function createSidePocketPlate(
  pocket: PocketGeometry,
  equipment: TableEquipment,
  top: number,
) {
  const { spec } = pocket;
  const points = pocket.back.map((point, i) => {
    const normal = pocket.backNormals[i];
    return new Vector2(
      point.x + normal.x * pocket.rimWidth,
      point.y + normal.y * pocket.rimWidth,
    );
  });
  const halfWidth = pocket.cavityRadius + pocket.rimWidth;
  const border = equipment.cushionWidth + equipment.frameWidth;
  const worldPoint = (u: number, v: number) =>
    new Vector2(
      spec.originX - spec.dy * u + spec.dx * v,
      spec.originY + spec.dx * u + spec.dy * v,
    );
  points.push(worldPoint(-halfWidth, equipment.cushionWidth));
  points.push(worldPoint(-halfWidth, border));
  points.push(worldPoint(halfWidth, border));
  points.push(worldPoint(halfWidth, equipment.cushionWidth));
  return extrudePlate(
    points.map((point) => new Vector2(point.x, -point.y)),
    top,
  );
}

function extrudePlate(world: Vector2[], top: number) {
  const geometry = new ExtrudeGeometry(new Shape(world), {
    depth: 0.003,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: 0.0006,
    bevelThickness: 0.0006,
    bevelOffset: -0.0006,
    curveSegments: 48,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, top - 0.002, 0);
  // 使用世界米制纹理坐标，使金属拉丝在四角和中袋上的尺度一致。
  const positions = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < positions.count; i++)
    uv.setXY(i, positions.getX(i), positions.getZ(i));
  return geometry;
}
