import { CHINESE_EIGHT, type TableEquipment } from "../equipment";
import type { Point } from "../pocket-geometry";
import { getPocketGeometries, pocketWorld } from "../pocket-geometry";
import { px } from "./layout";

function path(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  close: boolean,
) {
  ctx.beginPath();
  ctx.moveTo(px(points[0].x), px(points[0].y));
  for (const point of points.slice(1)) ctx.lineTo(px(point.x), px(point.y));
  if (close) ctx.closePath();
}

/** 袋口在库边与球的下方绘制；皮革只围袋后，台呢沿共享袋颚包入。 */
export function paintPockets(
  ctx: CanvasRenderingContext2D,
  equipment: TableEquipment = CHINESE_EIGHT,
) {
  for (const pocket of getPocketGeometries(equipment)) {
    const { spec, opening, back, rearDepth, rearHalf, front } = pocket;
    const entrance = pocketWorld(spec, 0, front);
    const deep = pocketWorld(spec, 0, rearDepth + rearHalf);
    const center = pocketWorld(spec, 0, rearDepth);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // 后包口叠在木框上，两端被台呢袋颚覆盖，入口不出现悬浮圆环。
    path(ctx, back, false);
    ctx.strokeStyle = "rgba(7, 5, 3, 0.5)";
    ctx.lineWidth = px(0.023);
    ctx.stroke();
    const leather = ctx.createLinearGradient(
      px(entrance.x),
      px(entrance.y),
      px(deep.x),
      px(deep.y),
    );
    leather.addColorStop(0, "#493222");
    leather.addColorStop(0.55, "#684830");
    leather.addColorStop(1, "#38281d");
    ctx.strokeStyle = leather;
    ctx.lineWidth = px(0.017);
    ctx.stroke();
    ctx.strokeStyle = "rgba(201, 156, 103, 0.18)";
    ctx.lineWidth = px(0.01);
    ctx.stroke();

    path(ctx, opening, true);
    ctx.clip();
    const cavity = ctx.createLinearGradient(
      px(entrance.x),
      px(entrance.y),
      px(deep.x),
      px(deep.y),
    );
    cavity.addColorStop(0, "#0c2217");
    cavity.addColorStop(0.18, "#08140e");
    cavity.addColorStop(0.65, "#020504");
    cavity.addColorStop(1, "#171512");
    ctx.fillStyle = cavity;
    ctx.fill();
    // 袋壁仅在靠近后壁处留下柔和反射，不能用纯黑平面圆片代替深度。
    const wall = ctx.createRadialGradient(
      px(center.x),
      px(center.y),
      px(rearHalf * 0.55),
      px(center.x),
      px(center.y),
      px(rearHalf),
    );
    wall.addColorStop(0, "rgba(0,0,0,0)");
    wall.addColorStop(0.8, "rgba(19,16,12,0.15)");
    wall.addColorStop(1, "rgba(103,81,54,0.24)");
    ctx.fillStyle = wall;
    ctx.fill();
    ctx.restore();
  }
}
