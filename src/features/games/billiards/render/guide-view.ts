import type { Graphics } from "pixi.js";

import { BALL_RADIUS } from "../constants";
import type { AimGuide } from "./guides";
import { px } from "./layout";

export function drawGuide(g: Graphics, guide: AimGuide): void {
  const cx = px(guide.cue.x);
  const cy = px(guide.cue.y);
  const ix = px(guide.contact.x);
  const iy = px(guide.contact.y);
  const distance = Math.hypot(ix - cx, iy - cy);
  const ux = distance > 0 ? (ix - cx) / distance : 0;
  const uy = distance > 0 ? (iy - cy) / distance : 0;
  for (let d = px(BALL_RADIUS); d < distance; d += 10) {
    const end = Math.min(d + 6, distance);
    g.moveTo(cx + ux * d, cy + uy * d).lineTo(cx + ux * end, cy + uy * end);
  }
  g.stroke({ width: 1.3, color: 0xffffff, alpha: 0.62 });
  g.circle(ix, iy, px(BALL_RADIUS))
    .fill({ color: 0xffffff, alpha: 0.04 })
    .stroke({ width: 1, color: 0xffffff, alpha: 0.7 });
  if (guide.target) {
    const { center, dir, length } = guide.target;
    g.moveTo(px(center.x), px(center.y))
      .lineTo(px(center.x + dir.x * length), px(center.y + dir.y * length))
      .stroke({ width: 1.6, color: 0xffe1a0, alpha: 0.9 });
  }
  if (guide.cueDeflection && guide.target) {
    g.moveTo(ix, iy)
      .lineTo(
        ix + px(guide.cueDeflection.x * guide.cueLength),
        iy + px(guide.cueDeflection.y * guide.cueLength),
      )
      .stroke({ width: 1.1, color: 0xffffff, alpha: 0.36 });
  }
}
