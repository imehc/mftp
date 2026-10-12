/**
 * 静态球桌渲染，外加共用的世界→像素比例。
 *
 * 整张球桌——木框、台呢面、库边、袋口、标记——一次性绘制到画布上，
 * 作为单个精灵显示。这里用 Canvas 2D 而非 Pixi 的 `Graphics`，因为
 * 此处的立体感线索全都是渐变：rails 上的倒角、库边斜面直到台面、
 * 库边投在台呢上的阴影、袋口内的凹陷。`Graphics` 只能叠平涂色块，
 * 这正是早先的球桌看起来像纸的原因。
 *
 * 绘制以世界像素（米 × PPM）进行，原点在球桌中心，因此下面的每个
 * 坐标都与物理常量一致。
 */
import { Container, Sprite, Texture } from "pixi.js";

import { CHINESE_EIGHT, type TableEquipment } from "../equipment";
import { cushionSegments } from "../geometry";
import { BAULK_X, COLOR_SPOTS, D_RADIUS } from "../snooker-equipment";
import { OUTER_H, OUTER_W, PPM, px, tableLayout } from "./layout";
import { paintPockets } from "./pockets";
import { makeClothTile, makeLeatherTile, makeWoodCanvas } from "./textures";

export { OUTER_H, OUTER_W, PPM, px };

/**
 * 绘制球桌的超采样系数。根容器会缩放以适配视口，因此纹理按大于标称
 * 尺寸绘制，以免在宽屏上被放大时变糊。
 */
const SS = 2;
/** 木框四周的内边距（米），避免投影被裁切。 */
const PAD = 0.04;
/** 木框外圆角半径，单位为米。 */
const FRAME_RADIUS = 0.07;

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 将球桌绘制到尺寸为木框加投影内边距的画布上。 */
function paintTable(equipment: TableEquipment): HTMLCanvasElement {
  const { FRAME, OUTER_W, OUTER_H } = tableLayout(equipment);
  const {
    tableWidth: TABLE_W,
    tableHeight: TABLE_H,
    cushionWidth: CUSHION_THICKNESS,
  } = equipment;
  const FOOT_SPOT_X = TABLE_W / 4;
  const HEAD_SPOT_X = -TABLE_W / 4;
  const halfW = px(OUTER_W + PAD);
  const halfH = px(OUTER_H + PAD);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(halfW * 2 * SS);
  canvas.height = Math.ceil(halfH * 2 * SS);
  const ctx = canvas.getContext("2d")!;
  // 以世界像素绘制，原点在球桌中心。
  ctx.setTransform(SS, 0, 0, SS, halfW * SS, halfH * SS);

  const fw = px(OUTER_W);
  const fh = px(OUTER_H);
  const fr = px(FRAME_RADIUS);

  // --- 木框 ------------------------------------------------------
  // 先画投影：球桌浮在页面之上，而非印在页面里。
  // 投影模糊/偏移以设备像素计，因此要乘上 SS 系数。
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = px(0.05) * SS;
  ctx.shadowOffsetY = px(0.014) * SS;
  roundRectPath(ctx, -fw, -fh, fw * 2, fh * 2, fr);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();

  // 木纹，裁剪到木框范围内。
  ctx.save();
  roundRectPath(ctx, -fw, -fh, fw * 2, fh * 2, fr);
  ctx.clip();
  const wood = makeWoodCanvas(Math.ceil(fw * 2), Math.ceil(fh * 2));
  ctx.drawImage(wood, -fw, -fh, fw * 2, fh * 2);
  // 倒角：rails 从左上方的顶光处向外滚落。
  const bevel = ctx.createLinearGradient(-fw, -fh, fw, fh);
  bevel.addColorStop(0, "rgba(255, 226, 178, 0.18)");
  bevel.addColorStop(0.4, "rgba(255, 226, 178, 0.02)");
  bevel.addColorStop(1, "rgba(0, 0, 0, 0.3)");
  ctx.fillStyle = bevel;
  ctx.fillRect(-fw, -fh, fw * 2, fh * 2);
  ctx.restore();

  // 木框外缘清晰的唇边。
  roundRectPath(ctx, -fw, -fh, fw * 2, fh * 2, fr);
  ctx.lineWidth = px(0.006);
  ctx.strokeStyle = "rgba(20, 11, 6, 0.85)";
  ctx.stroke();
  roundRectPath(
    ctx,
    -fw + px(0.005),
    -fh + px(0.005),
    (fw - px(0.005)) * 2,
    (fh - px(0.005)) * 2,
    fr - px(0.005),
  );
  ctx.lineWidth = px(0.003);
  ctx.strokeStyle = "rgba(255, 214, 160, 0.14)";
  ctx.stroke();

  // 四角护边与木框共用外轮廓，随后由台呢开口裁出内侧，避免浮在台面上。
  ctx.save();
  roundRectPath(ctx, -fw, -fh, fw * 2, fh * 2, fr);
  ctx.clip();
  const leather = ctx.createPattern(makeLeatherTile(), "repeat");
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cap = px(0.235);
      const x = sx < 0 ? -fw : fw - cap;
      const y = sy < 0 ? -fh : fh - cap;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cap, cap);
      ctx.clip();
      ctx.fillStyle = leather ?? "#30231c";
      ctx.fillRect(x, y, cap, cap);
      // 皮革只有柔和漫反射，压边比粒面更暗，不出现银色镜面条纹。
      const softness = ctx.createLinearGradient(-fw, -fh, fw, fh);
      softness.addColorStop(0, "rgba(214, 172, 126, 0.22)");
      softness.addColorStop(0.45, "rgba(192, 149, 102, 0.03)");
      softness.addColorStop(1, "rgba(0, 0, 0, 0.25)");
      ctx.fillStyle = softness;
      ctx.fillRect(x, y, cap, cap);
      ctx.strokeStyle = "rgba(12, 7, 4, 0.7)";
      ctx.lineWidth = px(0.003);
      ctx.strokeRect(x, y, cap, cap);
      // 护边有厚度：暗色滚边内侧接柔和受光面，轮廓共用桌框圆角。
      roundRectPath(
        ctx,
        -fw + px(0.004),
        -fh + px(0.004),
        (fw - px(0.004)) * 2,
        (fh - px(0.004)) * 2,
        fr - px(0.004),
      );
      ctx.lineWidth = px(0.01);
      ctx.strokeStyle = "rgba(13, 7, 3, 0.48)";
      ctx.stroke();
      roundRectPath(
        ctx,
        -fw + px(0.009),
        -fh + px(0.009),
        (fw - px(0.009)) * 2,
        (fh - px(0.009)) * 2,
        fr - px(0.009),
      );
      const edgeLight = ctx.createLinearGradient(-fw, -fh, fw, fh);
      edgeLight.addColorStop(0, "rgba(208, 158, 108, 0.38)");
      edgeLight.addColorStop(0.5, "rgba(171, 118, 73, 0.15)");
      edgeLight.addColorStop(1, "rgba(5, 3, 1, 0.3)");
      ctx.lineWidth = px(0.006);
      ctx.strokeStyle = edgeLight;
      ctx.stroke();
      // 沿真实圆角缝制，线迹跟随木框外轮廓，避免方形贴纸感。
      const inset = px(0.019);
      roundRectPath(
        ctx,
        -fw + inset,
        -fh + inset,
        (fw - inset) * 2,
        (fh - inset) * 2,
        fr - inset,
      );
      ctx.setLineDash([px(0.004), px(0.003)]);
      ctx.lineWidth = px(0.0012);
      ctx.strokeStyle = "rgba(171, 129, 88, 0.5)";
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();

  // --- 台面 ------------------------------------------------------
  // 台呢覆盖整个 rails 开口；库边再叠在其外圈之上，这样台呢与库边
  // 之间不会出现接缝。
  const openX = px(-(TABLE_W / 2 + CUSHION_THICKNESS));
  const openY = px(-(TABLE_H / 2 + CUSHION_THICKNESS));
  const openW = px(TABLE_W + CUSHION_THICKNESS * 2);
  const openH = px(TABLE_H + CUSHION_THICKNESS * 2);

  ctx.save();
  roundRectPath(ctx, openX, openY, openW, openH, px(0.012));
  ctx.clip();
  const cloth = ctx.createPattern(makeClothTile(), "repeat");
  if (cloth) {
    ctx.fillStyle = cloth;
    ctx.fillRect(openX, openY, openW, openH);
  }
  ctx.restore();

  paintPockets(ctx, equipment);

  // --- 库边 ------------------------------------------------------
  // 每个凸包为 [inner0, inner1, outer1, outer0]。明暗从 rails 处受光的
  // 顶面一直延伸到与台面相接的库边尖端。
  for (const segment of cushionSegments(equipment)) {
    const [ix0, iy0, ix1, iy1, ox1, oy1, ox0, oy0] = segment.profile;

    const path = (): void => {
      ctx.beginPath();
      ctx.moveTo(px(segment.points[0]), px(segment.points[1]));
      for (let i = 2; i < segment.points.length; i += 2)
        ctx.lineTo(px(segment.points[i]), px(segment.points[i + 1]));
      ctx.closePath();
    };

    // 用内沿法线投影库宽，袋颚非对称退让不能把整段库面的渐变带偏。
    const edgeX = ix1 - ix0;
    const edgeY = iy1 - iy0;
    const edgeSize = Math.hypot(edgeX, edgeY);
    const normalX = -edgeY / edgeSize;
    const normalY = edgeX / edgeSize;
    const depth =
      ((ox0 + ox1 - ix0 - ix1) * normalX + (oy0 + oy1 - iy0 - iy1) * normalY) /
      2;
    const nx = -normalX * depth;
    const ny = -normalY * depth;
    const centerX = (ix0 + ix1) / 2;
    const centerY = (iy0 + iy1) / 2;
    const face = ctx.createLinearGradient(
      px(centerX - nx),
      px(centerY - ny),
      px(centerX),
      px(centerY),
    );
    // 左上方统一主光，仅坡面朝向影响受光强度。
    const facingLight = -(nx * 0.6 + ny * 0.8) / Math.hypot(nx, ny);
    const light = 1 + facingLight * 0.18;
    const tint = (r: number, g: number, b: number) =>
      `rgb(${Math.round(r * light)}, ${Math.round(g * light)}, ${Math.round(b * light)})`;
    face.addColorStop(0, tint(43, 119, 78));
    face.addColorStop(0.22, tint(49, 131, 85));
    face.addColorStop(0.72, tint(36, 105, 66));
    face.addColorStop(0.94, tint(27, 82, 51));
    face.addColorStop(1, tint(23, 69, 44));

    // 投影沿真实库边轮廓生成，台呢及袋口通道共享同一底色与光照，
    // 避免按矩形台面裁剪阴影造成通道与台面之间的色块断层。
    ctx.save();
    path();
    ctx.shadowColor = "rgba(3, 18, 12, 0.42)";
    ctx.shadowBlur = px(0.007) * SS;
    ctx.shadowOffsetX = px(0.004) * SS;
    ctx.shadowOffsetY = px(0.006) * SS;
    ctx.fillStyle = face;
    ctx.fill();
    ctx.restore();

    // 弧形袋颚沿真实曲线产生局部近接阴影；不以斜切直线渐变铺满整段库边。
    ctx.save();
    path();
    ctx.clip();
    for (const jaw of segment.jaws) {
      ctx.beginPath();
      ctx.moveTo(px(jaw[0].x), px(jaw[0].y));
      for (const point of jaw.slice(1)) ctx.lineTo(px(point.x), px(point.y));
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(3, 23, 13, 0.18)";
      ctx.lineWidth = px(0.024);
      ctx.stroke();
      ctx.strokeStyle = "rgba(2, 18, 11, 0.24)";
      ctx.lineWidth = px(0.008);
      ctx.stroke();
    }
    ctx.restore();

    // 库边尖端与台面相接处的暗缝。
    ctx.beginPath();
    ctx.moveTo(px(ix0), px(iy0));
    ctx.lineTo(px(ix1), px(iy1));
    ctx.lineCap = "round";
    ctx.lineWidth = px(0.0015);
    ctx.strokeStyle = "rgba(4, 24, 15, 0.28)";
    ctx.stroke();
  }

  const bedY = px(-TABLE_H / 2);
  const bedH = px(TABLE_H);

  // --- 标记 ------------------------------------------------------
  const snooker = equipment.id === "snooker";
  const lineX = snooker ? BAULK_X : HEAD_SPOT_X;
  ctx.beginPath();
  ctx.moveTo(px(lineX), bedY);
  ctx.lineTo(px(lineX), bedY + bedH);
  ctx.lineWidth = px(snooker ? 0.0015 : 0.004);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.stroke();
  if (snooker) {
    ctx.beginPath();
    ctx.arc(px(BAULK_X), 0, px(D_RADIUS), Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();
  }
  for (const spot of snooker
    ? Object.values(COLOR_SPOTS)
    : [{ x: FOOT_SPOT_X, y: 0 }]) {
    ctx.beginPath();
    ctx.arc(
      px(spot.x),
      px(spot.y),
      px(snooker ? 0.004 : 0.011),
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "rgba(238, 232, 220, 0.42)";
    ctx.fill();
  }

  // 库边瞄准点：嵌入木框的珍珠母镶饰。
  const sightY = px(TABLE_H / 2 + CUSHION_THICKNESS + FRAME / 2);
  const sightX = px(TABLE_W / 2 + CUSHION_THICKNESS + FRAME / 2);

  const drawSight = (x: number, y: number): void => {
    const s = px(0.011);

    const diamond = (scale: number): void => {
      ctx.beginPath();
      ctx.moveTo(x, y - s * scale);
      ctx.lineTo(x + s * scale, y);
      ctx.lineTo(x, y + s * scale);
      ctx.lineTo(x - s * scale, y);
      ctx.closePath();
    };

    // 先画凹陷阴影，再画镶饰，最后在受光面点一抹高光。
    diamond(1.12);
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fill();
    diamond(1);
    const inlay = ctx.createLinearGradient(x - s, y - s, x + s, y + s);
    inlay.addColorStop(0, "#fffdf7");
    inlay.addColorStop(0.55, "#ece3d2");
    inlay.addColorStop(1, "#c9bda6");
    ctx.fillStyle = inlay;
    ctx.fill();
    diamond(0.42);
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.fill();
  };

  for (const k of snooker ? [] : [-3, -2, -1, 1, 2, 3]) {
    const x = px((k * TABLE_W) / 8);
    drawSight(x, -sightY);
    drawSight(x, sightY);
  }
  for (const k of snooker ? [] : [-1, 0, 1]) {
    const y = px((k * TABLE_H) / 4);
    drawSight(-sightX, y);
    drawSight(sightX, y);
  }

  return canvas;
}

/** 构建静态球桌：木框、台呢、库边、标记、袋口。 */
export function buildTable(
  equipment: TableEquipment = CHINESE_EIGHT,
): Container {
  const { OUTER_W, OUTER_H } = tableLayout(equipment);
  const container = new Container();
  const sprite = new Sprite(Texture.from(paintTable(equipment)));
  sprite.x = px(-(OUTER_W + PAD));
  sprite.y = px(-(OUTER_H + PAD));
  sprite.width = px((OUTER_W + PAD) * 2);
  sprite.height = px((OUTER_H + PAD) * 2);
  container.addChild(sprite);
  return container;
}
