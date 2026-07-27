/** Static table drawing and the shared world-to-pixel scale. */
import { Graphics } from "pixi.js";
import {
  CUSHION_THICKNESS,
  FOOT_SPOT_X,
  HEAD_SPOT_X,
  POCKETS,
  TABLE_H,
  TABLE_W,
} from "../constants";
import { cushionSegments } from "../physics";

/** Pixels per meter at root scale 1 (text stays crisp when downscaled). */
export const PPM = 320;
/** Wood frame width beyond the cushions, meters. */
const FRAME = 0.09;
/** Outer half-extents of the drawn table (wood frame included), meters. */
export const OUTER_W = TABLE_W / 2 + CUSHION_THICKNESS + FRAME;
export const OUTER_H = TABLE_H / 2 + CUSHION_THICKNESS + FRAME;

export const px = (m: number): number => m * PPM;

/** Build the static table: frame, felt, cushions, markings, pockets. */
export function buildTable(): Graphics {
  const table = new Graphics();
  table
    .roundRect(px(-OUTER_W), px(-OUTER_H), px(OUTER_W * 2), px(OUTER_H * 2), px(0.07))
    .fill(0x5d4037)
    .roundRect(
      px(-(TABLE_W / 2 + CUSHION_THICKNESS)),
      px(-(TABLE_H / 2 + CUSHION_THICKNESS)),
      px(TABLE_W + CUSHION_THICKNESS * 2),
      px(TABLE_H + CUSHION_THICKNESS * 2),
      px(0.02),
    )
    .fill(0x1e5e40);
  // Cushions reuse the physics hulls so the picture matches the collisions.
  for (const segment of cushionSegments()) {
    table.poly(segment.points.map((v) => px(v))).fill(0x2a7a54);
  }
  // Felt playing surface on top of the cushion band background.
  table
    .rect(px(-TABLE_W / 2), px(-TABLE_H / 2), px(TABLE_W), px(TABLE_H))
    .fill(0x2e8557);
  // Head string + foot spot markings.
  table
    .moveTo(px(HEAD_SPOT_X), px(-TABLE_H / 2))
    .lineTo(px(HEAD_SPOT_X), px(TABLE_H / 2))
    .stroke({ width: 1.5, color: 0xffffff, alpha: 0.14 });
  table.circle(px(FOOT_SPOT_X), 0, 3).fill({ color: 0xffffff, alpha: 0.35 });
  // Rail sights (diamonds).
  const sightRail = TABLE_H / 2 + CUSHION_THICKNESS + FRAME / 2;
  const sightRailX = TABLE_W / 2 + CUSHION_THICKNESS + FRAME / 2;
  const sightXs = [-3, -2, -1, 1, 2, 3].map((k) => (k * TABLE_W) / 8);
  const sightYs = [-1, 0, 1].map((k) => (k * TABLE_H) / 4);
  const drawSight = (x: number, y: number): void => {
    const s = 3.4;
    table
      .poly([x, y - s, x + s, y, x, y + s, x - s, y])
      .fill({ color: 0xe8ddc8, alpha: 0.6 });
  };
  for (const sx of sightXs) {
    drawSight(px(sx), px(-sightRail));
    drawSight(px(sx), px(sightRail));
  }
  for (const sy of sightYs) {
    drawSight(px(-sightRailX), px(sy));
    drawSight(px(sightRailX), px(sy));
  }
  // Cushion inner-face highlight.
  for (const segment of cushionSegments()) {
    table
      .moveTo(px(segment.points[0]), px(segment.points[1]))
      .lineTo(px(segment.points[2]), px(segment.points[3]))
      .stroke({ width: 2, color: 0x5cb283, alpha: 0.5 });
  }
  for (const pocket of POCKETS) {
    table
      .circle(px(pocket.x), px(pocket.y), px(pocket.radius * 0.92))
      .fill(0x0c0c0c)
      .circle(px(pocket.x), px(pocket.y), px(pocket.radius * 0.92))
      .stroke({ width: 3, color: 0x3a2a20, alpha: 0.9 });
  }
  return table;
}
