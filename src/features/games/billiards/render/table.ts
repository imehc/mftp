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
import {
  CUSHION_THICKNESS,
  FOOT_SPOT_X,
  HEAD_SPOT_X,
  POCKETS,
  TABLE_H,
  TABLE_W,
} from "../constants";
import { cushionSegments } from "../physics";
import { FRAME, OUTER_H, OUTER_W, PPM, px } from "./layout";
import { CLOTH_BASE, makeClothTile, makeWoodCanvas } from "./textures";

export { OUTER_H, OUTER_W, PPM, px };

/** 台呢基色（r, g, b 形式），用于拼接 rgba() 字符串。 */
const CLOTH_RGB = CLOTH_BASE.join(", ");

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
function paintTable(): HTMLCanvasElement {
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

  // --- 库边 ------------------------------------------------------
  // 每个凸包为 [inner0, inner1, outer1, outer0]。明暗从 rails 处受光的
  // 顶面一直延伸到与台面相接的库边尖端。
  for (const segment of cushionSegments()) {
    const [ix0, iy0, ix1, iy1, ox1, oy1, ox0, oy0] = segment.points;
    const path = (): void => {
      ctx.beginPath();
      ctx.moveTo(px(ix0), px(iy0));
      ctx.lineTo(px(ix1), px(iy1));
      ctx.lineTo(px(ox1), px(oy1));
      ctx.lineTo(px(ox0), px(oy0));
      ctx.closePath();
    };

    const face = ctx.createLinearGradient(
      px((ox0 + ox1) / 2),
      px((oy0 + oy1) / 2),
      px((ix0 + ix1) / 2),
      px((iy0 + iy1) / 2),
    );
    face.addColorStop(0, "#2f8757");
    face.addColorStop(0.4, "#26714a");
    face.addColorStop(0.82, "#1a5335");
    face.addColorStop(1, "#123d26");

    path();
    ctx.fillStyle = face;
    ctx.fill();

    // 颚面。每个库边在袋口处被截断，而那段切口是覆盖台面的同种台呢——
    // 因此在切口处落到台面颜色，并朝内重新融入受光的库边顶面。渐变
    // 垂直于切口，以贴合斜接。
    ctx.save();
    path();
    ctx.clip();
    const jaw = (
      ex: number,
      ey: number,
      cutX: number,
      cutY: number,
      towardX: number,
      towardY: number,
    ): void => {
      // 切口的内法线：指向库边本体而非朝袋口外侧的垂直方向。
      let nx = -(cutY - ey);
      let ny = cutX - ex;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      if (nx * (towardX - ex) + ny * (towardY - ey) < 0) {
        nx = -nx;
        ny = -ny;
      }
      const reach = px(0.055);
      const g = ctx.createLinearGradient(
        ex,
        ey,
        ex + nx * reach,
        ey + ny * reach,
      );
      g.addColorStop(0, `rgba(${CLOTH_RGB}, 1)`);
      g.addColorStop(0.45, `rgba(${CLOTH_RGB}, 0.72)`);
      g.addColorStop(1, `rgba(${CLOTH_RGB}, 0)`);
      path();
      ctx.fillStyle = g;
      ctx.fill();
    };
    jaw(px(ix0), px(iy0), px(ox0), px(oy0), px(ix1), px(iy1));
    jaw(px(ix1), px(iy1), px(ox1), px(oy1), px(ix0), px(iy0));
    ctx.restore();

    // 库边尖端与台面相接处的暗缝。
    ctx.beginPath();
    ctx.moveTo(px(ix0), px(iy0));
    ctx.lineTo(px(ix1), px(iy1));
    ctx.lineWidth = px(0.004);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.stroke();
  }

  // 库边投在台呢上的阴影，在顶部与左侧 rails 下方最强，以匹配木框
  // 所用的光照。
  const bedX = px(-TABLE_W / 2);
  const bedY = px(-TABLE_H / 2);
  const bedW = px(TABLE_W);
  const bedH = px(TABLE_H);
  const reach = px(0.055);
  ctx.save();
  ctx.beginPath();
  ctx.rect(bedX, bedY, bedW, bedH);
  ctx.clip();
  const edgeShadow = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    strength: number,
  ): void => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(0, 0, 0, ${strength})`);
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(bedX, bedY, bedW, bedH);
  };
  edgeShadow(bedX, bedY, bedX, bedY + reach, 0.34);
  edgeShadow(bedX, bedY, bedX + reach, bedY, 0.3);
  edgeShadow(bedX, bedY + bedH, bedX, bedY + bedH - reach, 0.2);
  edgeShadow(bedX + bedW, bedY, bedX + bedW - reach, bedY, 0.18);
  ctx.restore();

  // --- 标记 ------------------------------------------------------
  ctx.beginPath();
  ctx.moveTo(px(HEAD_SPOT_X), bedY);
  ctx.lineTo(px(HEAD_SPOT_X), bedY + bedH);
  ctx.lineWidth = px(0.004);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.13)";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(px(FOOT_SPOT_X), 0, px(0.011), 0, Math.PI * 2);
  ctx.fillStyle = "rgba(238, 232, 220, 0.42)";
  ctx.fill();

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
  for (const k of [-3, -2, -1, 1, 2, 3]) {
    const x = px((k * TABLE_W) / 8);
    drawSight(x, -sightY);
    drawSight(x, sightY);
  }
  for (const k of [-1, 0, 1]) {
    const y = px((k * TABLE_H) / 4);
    drawSight(-sightX, y);
    drawSight(sightX, y);
  }

  // --- 袋口 ------------------------------------------------------
  for (const pocket of POCKETS) {
    const cx = px(pocket.x);
    const cy = px(pocket.y);
    const pr = px(pocket.radius);

    // 台呢喉部：台面向洞口下陷，越远越暗。它位于皮圈之下，因此看起来
    // 是凹陷而非画上去的一圈。
    const throat = ctx.createRadialGradient(
      cx,
      cy,
      pr * 0.3,
      cx,
      cy,
      pr * 1.15,
    );
    throat.addColorStop(0, "rgba(0, 0, 0, 0.55)");
    throat.addColorStop(0.65, "rgba(0, 0, 0, 0.28)");
    throat.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.beginPath();
    ctx.arc(cx, cy, pr * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = throat;
    ctx.fill();

    // 袋口周围的皮圈。
    const collar = ctx.createRadialGradient(
      cx,
      cy,
      pr * 0.6,
      cx,
      cy,
      pr * 1.08,
    );
    collar.addColorStop(0, "#3a281c");
    collar.addColorStop(0.7, "#241811");
    collar.addColorStop(1, "rgba(12, 8, 5, 0)");
    ctx.beginPath();
    ctx.arc(cx, cy, pr * 1.08, 0, Math.PI * 2);
    ctx.fillStyle = collar;
    ctx.fill();

    // 洞口：中心为黑，朝受光的近缘渐亮。
    const hole = ctx.createRadialGradient(
      cx - pr * 0.2,
      cy - pr * 0.2,
      pr * 0.06,
      cx,
      cy,
      pr * 0.92,
    );
    hole.addColorStop(0, "#000000");
    hole.addColorStop(0.72, "#050505");
    hole.addColorStop(1, "#1c1613");
    ctx.beginPath();
    ctx.arc(cx, cy, pr * 0.9, 0, Math.PI * 2);
    ctx.fillStyle = hole;
    ctx.fill();

    // 边缘：近侧暗，远侧横过受光。
    ctx.beginPath();
    ctx.arc(cx, cy, pr * 0.9, 0, Math.PI * 2);
    const rim = ctx.createLinearGradient(cx - pr, cy - pr, cx + pr, cy + pr);
    rim.addColorStop(0, "rgba(0, 0, 0, 0.8)");
    rim.addColorStop(0.55, "rgba(90, 66, 48, 0.5)");
    rim.addColorStop(1, "rgba(168, 132, 92, 0.55)");
    ctx.lineWidth = px(0.008);
    ctx.strokeStyle = rim;
    ctx.stroke();
  }

  return canvas;
}

/** 构建静态球桌：木框、台呢、库边、标记、袋口。 */
export function buildTable(): Container {
  const container = new Container();
  const sprite = new Sprite(Texture.from(paintTable()));
  sprite.x = px(-(OUTER_W + PAD));
  sprite.y = px(-(OUTER_H + PAD));
  sprite.width = px((OUTER_W + PAD) * 2);
  sprite.height = px((OUTER_H + PAD) * 2);
  container.addChild(sprite);
  return container;
}
