/** Ball views: fake-3D shaded spheres with a rolling number decal. */
import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { ballColorNumber } from "../colors";
import { BALL_RADIUS } from "../constants";
import type { BallState } from "../types";
import { px } from "./table";

/** Ball radius in pixels at root scale 1. */
const r = px(BALL_RADIUS);

/** Fake-3D rolling state for the number decal on each ball. */
interface RollState {
  phase: number;
  dirX: number;
  dirY: number;
  lastX: number;
  lastY: number;
}

export interface BallLayer {
  layer: Container;
  /** View for one ball id (0–15). */
  view(id: number): Container | undefined;
  /** Move a ball view; `rolling` advances the number decal with it. */
  move(id: number, x: number, y: number, rolling: boolean): void;
  /** Snap every view to the resolved state (position, visibility). */
  sync(balls: BallState[]): void;
}

export function createBallLayer(): BallLayer {
  const layer = new Container();
  const ballViews = new Map<number, Container>();
  const decals = new Map<number, { decal: Container; roll: RollState }>();

  function buildBall(id: number): Container {
    const view = new Container();
    const color = ballColorNumber(id);
    const striped = id >= 9;
    // Soft contact shadow (two stacked translucent discs).
    const shadow = new Graphics();
    shadow
      .circle(r * 0.16, r * 0.2, r * 1.14)
      .fill({ color: 0x000000, alpha: 0.1 })
      .circle(r * 0.12, r * 0.16, r * 0.98)
      .fill({ color: 0x000000, alpha: 0.16 });
    view.addChild(shadow);
    const g = new Graphics();
    g.circle(0, 0, r).fill(striped ? 0xf6f1e7 : color);
    if (striped) {
      const band = new Graphics();
      band.rect(-r, -r * 0.52, r * 2, r * 1.04).fill(color);
      const bandMask = new Graphics();
      bandMask.circle(0, 0, r).fill(0xffffff);
      band.mask = bandMask;
      view.addChild(g, bandMask, band);
    } else {
      view.addChild(g);
    }
    if (id !== 0) {
      const decal = new Container();
      const dot = new Graphics();
      dot.circle(0, 0, r * 0.46).fill(0xf6f1e7);
      const label = new Text({
        text: String(id),
        style: new TextStyle({
          fontSize: r * 0.62,
          fill: 0x1a1a1a,
          fontWeight: "700",
          fontFamily: "system-ui, sans-serif",
        }),
      });
      label.anchor.set(0.5);
      label.resolution = 3;
      decal.addChild(dot, label);
      const decalMask = new Graphics();
      decalMask.circle(0, 0, r * 0.98).fill(0xffffff);
      decal.mask = decalMask;
      view.addChild(decalMask, decal);
      decals.set(id, {
        decal,
        roll: { phase: 0, dirX: 1, dirY: 0, lastX: 0, lastY: 0 },
      });
    }
    // Sphere shading: darken everything but a top-left crescent.
    const shadeMask = new Graphics();
    shadeMask.circle(0, 0, r).fill(0xffffff);
    const shade = new Graphics();
    shade.circle(r * 0.2, r * 0.24, r).fill({ color: 0x000000, alpha: 0.16 });
    shade.mask = shadeMask;
    view.addChild(shadeMask, shade);
    const shine = new Graphics();
    shine
      .circle(-r * 0.32, -r * 0.36, r * 0.3)
      .fill({ color: 0xffffff, alpha: id === 0 ? 0.5 : 0.38 })
      .circle(-r * 0.28, -r * 0.32, r * 0.14)
      .fill({ color: 0xffffff, alpha: 0.5 });
    view.addChild(shine);
    return view;
  }

  /** Project the decal onto the "sphere": offset by sin, hide on the back. */
  function applyDecal(id: number): void {
    const entry = decals.get(id);
    if (!entry) return;
    const sin = Math.sin(entry.roll.phase);
    const cos = Math.cos(entry.roll.phase);
    entry.decal.position.set(
      entry.roll.dirX * sin * r,
      entry.roll.dirY * sin * r,
    );
    entry.decal.alpha = cos > 0 ? Math.min(1, cos * 1.4) : 0;
  }

  /**
   * Move a ball view; when `rolling`, advance the decal phase by the
   * surface distance traveled so the number appears to roll with the
   * ball instead of sliding. The phase is left wherever the ball stops —
   * no recentering — so resting positions look physical.
   */
  function moveBallView(id: number, x: number, y: number, rolling: boolean): void {
    const view = ballViews.get(id);
    if (!view) return;
    view.position.set(px(x), px(y));
    const entry = decals.get(id);
    if (!entry) return;
    const roll = entry.roll;
    if (rolling) {
      const dx = x - roll.lastX;
      const dy = y - roll.lastY;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-6) {
        roll.dirX = dx / dist;
        roll.dirY = dy / dist;
        roll.phase += dist / BALL_RADIUS;
        if (roll.phase > Math.PI * 4) roll.phase %= Math.PI * 2;
        applyDecal(id);
      }
    }
    roll.lastX = x;
    roll.lastY = y;
  }

  for (let id = 0; id <= 15; id++) {
    const view = buildBall(id);
    view.visible = false;
    ballViews.set(id, view);
    layer.addChild(view);
  }

  return {
    layer,
    view: (id) => ballViews.get(id),
    move: moveBallView,
    sync(balls) {
      for (const ball of balls) {
        const view = ballViews.get(ball.id);
        if (!view) continue;
        view.visible = !ball.potted;
        view.scale.set(1);
        view.alpha = 1;
        moveBallView(ball.id, ball.x, ball.y, false);
      }
    },
  };
}
