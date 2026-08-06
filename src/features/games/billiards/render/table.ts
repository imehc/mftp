/**
 * Static table rendering plus the shared world-to-pixel scale.
 *
 * The whole table — wood frame, cloth bed, cushions, pockets, markings — is
 * painted once into a canvas and shown as a single sprite. Canvas 2D is used
 * rather than Pixi `Graphics` because the depth cues here are all gradients:
 * the bevel down the rail, the cushion nose sloping to the bed, the shadow
 * the cushions cast on the cloth, the recess inside a pocket. `Graphics` can
 * only stack flat fills, which is what made the earlier table read as paper.
 *
 * Painting happens in world pixels (meters × PPM) with the origin at the
 * table centre, so every coordinate below matches the physics constants.
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

/** Cloth base as `r, g, b` for building rgba() strings. */
const CLOTH_RGB = CLOTH_BASE.join(", ");

/**
 * Supersample factor for the painted table. The root container is scaled to
 * fit the viewport, so the texture is drawn larger than its nominal size to
 * survive being magnified on a wide screen.
 */
const SS = 2;
/** Padding around the frame, in meters, so the drop shadow is not clipped. */
const PAD = 0.04;
/** Outer corner radius of the wood frame, meters. */
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

/** Paint the table into a canvas sized to the frame plus shadow padding. */
function paintTable(): HTMLCanvasElement {
  const halfW = px(OUTER_W + PAD);
  const halfH = px(OUTER_H + PAD);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(halfW * 2 * SS);
  canvas.height = Math.ceil(halfH * 2 * SS);
  const ctx = canvas.getContext("2d")!;
  // Draw in world pixels with the origin at the table centre.
  ctx.setTransform(SS, 0, 0, SS, halfW * SS, halfH * SS);

  const fw = px(OUTER_W);
  const fh = px(OUTER_H);
  const fr = px(FRAME_RADIUS);

  // --- frame ----------------------------------------------------------
  // Drop shadow first: the table sits above the page, not printed on it.
  // Shadow blur/offset are in device pixels, so they take the SS factor.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = px(0.05) * SS;
  ctx.shadowOffsetY = px(0.014) * SS;
  roundRectPath(ctx, -fw, -fh, fw * 2, fh * 2, fr);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();

  // Wood grain, clipped to the frame.
  ctx.save();
  roundRectPath(ctx, -fw, -fh, fw * 2, fh * 2, fr);
  ctx.clip();
  const wood = makeWoodCanvas(Math.ceil(fw * 2), Math.ceil(fh * 2));
  ctx.drawImage(wood, -fw, -fh, fw * 2, fh * 2);
  // Bevel: the rail rolls away from an overhead light at the top-left.
  const bevel = ctx.createLinearGradient(-fw, -fh, fw, fh);
  bevel.addColorStop(0, "rgba(255, 226, 178, 0.18)");
  bevel.addColorStop(0.4, "rgba(255, 226, 178, 0.02)");
  bevel.addColorStop(1, "rgba(0, 0, 0, 0.3)");
  ctx.fillStyle = bevel;
  ctx.fillRect(-fw, -fh, fw * 2, fh * 2);
  ctx.restore();

  // Crisp lip around the outside of the frame.
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

  // --- bed ------------------------------------------------------------
  // Cloth covers the whole rail opening; the cushions then sit on top of its
  // outer band, so no seam can show between cloth and cushion.
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

  // --- cushions -------------------------------------------------------
  // Each hull is [inner0, inner1, outer1, outer0]. Shading runs from the lit
  // top surface at the rail down to the nose that meets the cloth.
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

    // Jaw facings. Each cushion is cut off at a pocket mouth, and that cut is
    // the same cloth that covers the bed — so it resolves to the bed colour at
    // the cut and blends back into the lit cushion top going inward. The
    // gradient runs perpendicular to the cut so it follows the mitre.
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
      // Inward normal of the cut: the perpendicular that points along the
      // cushion body rather than out into the mouth.
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
      const g = ctx.createLinearGradient(ex, ey, ex + nx * reach, ey + ny * reach);
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

    // Dark seam where the nose meets the bed.
    ctx.beginPath();
    ctx.moveTo(px(ix0), px(iy0));
    ctx.lineTo(px(ix1), px(iy1));
    ctx.lineWidth = px(0.004);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.stroke();
  }

  // Shadow the cushions cast onto the cloth, strongest under the top and
  // left rails to match the light used on the frame.
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

  // --- markings -------------------------------------------------------
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

  // Rail sights: pearl inlays set into the wood.
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
    // Recess shadow, then the inlay, then a glint on its lit face.
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

  // --- pockets --------------------------------------------------------
  for (const pocket of POCKETS) {
    const cx = px(pocket.x);
    const cy = px(pocket.y);
    const pr = px(pocket.radius);

    // Cloth throat: the bed dips down toward the hole, darkening as it
    // recedes. This sits below the leather collar so it reads as recession
    // rather than as a drawn ring.
    const throat = ctx.createRadialGradient(cx, cy, pr * 0.3, cx, cy, pr * 1.15);
    throat.addColorStop(0, "rgba(0, 0, 0, 0.55)");
    throat.addColorStop(0.65, "rgba(0, 0, 0, 0.28)");
    throat.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.beginPath();
    ctx.arc(cx, cy, pr * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = throat;
    ctx.fill();

    // Leather collar around the mouth.
    const collar = ctx.createRadialGradient(cx, cy, pr * 0.6, cx, cy, pr * 1.08);
    collar.addColorStop(0, "#3a281c");
    collar.addColorStop(0.7, "#241811");
    collar.addColorStop(1, "rgba(12, 8, 5, 0)");
    ctx.beginPath();
    ctx.arc(cx, cy, pr * 1.08, 0, Math.PI * 2);
    ctx.fillStyle = collar;
    ctx.fill();

    // The hole: black at the centre, opening up toward the lit near edge.
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

    // Rim: dark on the near side, catching light across the far side.
    ctx.beginPath();
    ctx.arc(cx, cy, pr * 0.9, 0, Math.PI * 2);
    const rim = ctx.createLinearGradient(
      cx - pr,
      cy - pr,
      cx + pr,
      cy + pr,
    );
    rim.addColorStop(0, "rgba(0, 0, 0, 0.8)");
    rim.addColorStop(0.55, "rgba(90, 66, 48, 0.5)");
    rim.addColorStop(1, "rgba(168, 132, 92, 0.55)");
    ctx.lineWidth = px(0.008);
    ctx.strokeStyle = rim;
    ctx.stroke();
  }

  return canvas;
}

/** Build the static table: frame, cloth, cushions, markings, pockets. */
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
