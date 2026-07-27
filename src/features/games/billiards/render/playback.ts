/** Shot playback: replay recorded physics frames on the app ticker. */
import gsap from "gsap";
import type { Application, Container, Ticker } from "pixi.js";
import { FIXED_DT, POCKETS } from "../constants";
import type { BilliardsPresentation } from "../types";
import { playImpactEvent } from "./audio";
import { px } from "./table";

export interface PlaybackHooks {
  /** Move a ball view, rolling the number decal with it. */
  moveBall(id: number, x: number, y: number, rolling: boolean): void;
  /** View lookup for the pocket drop-in tween. */
  ballView(id: number): Container | undefined;
  /** Runs synchronously when the last frame lands, right before resolve. */
  onDone(): void;
}

/**
 * Play a resolved move's frames, firing sound and pocket drop-in tweens
 * at their recorded times. `frames` must be non-empty; resolves when the
 * table is at rest again.
 */
export function runPresentation(
  app: Application,
  presentation: BilliardsPresentation,
  hooks: PlaybackHooks,
): Promise<void> {
  const { frames, events } = presentation;
  return new Promise((resolve) => {
    let elapsed = 0;
    let eventIndex = 0;
    const positions = new Map<number, { x: number; y: number }>();

    const applyFrame = (frame: { balls: number[] }): void => {
      for (let i = 0; i < frame.balls.length; i += 3) {
        hooks.moveBall(
          frame.balls[i],
          frame.balls[i + 1],
          frame.balls[i + 2],
          true,
        );
      }
    };

    const tick = (ticker: Ticker): void => {
      elapsed += ticker.deltaMS / 1000;
      while (eventIndex < events.length && events[eventIndex].t <= elapsed) {
        const event = events[eventIndex++];
        playImpactEvent(event);
        if (event.type === "pocket") {
          const view = hooks.ballView(event.ball);
          const pocket = POCKETS.find((p) => p.id === event.pocket);
          if (view && pocket) {
            // Drop-in: dive from the capture point to the pocket center
            // while shrinking, like falling below the rim.
            gsap.killTweensOf(view);
            gsap.killTweensOf(view.scale);
            gsap.killTweensOf(view.position);
            gsap.to(view.position, {
              x: px(pocket.x),
              y: px(pocket.y),
              duration: 0.16,
              ease: "power2.in",
            });
            gsap.to(view.scale, {
              x: 0.45,
              y: 0.45,
              duration: 0.22,
              ease: "power2.in",
            });
            gsap.to(view, {
              alpha: 0,
              duration: 0.18,
              delay: 0.08,
              ease: "power1.in",
              onComplete: () => {
                view.visible = false;
              },
            });
          }
        }
      }
      const index = Math.floor(elapsed / FIXED_DT);
      if (index >= frames.length - 1) {
        applyFrame(frames[frames.length - 1]);
        app.ticker.remove(tick);
        hooks.onDone();
        resolve();
        return;
      }
      // Linear interpolation between recorded physics frames.
      const a = frames[index];
      const b = frames[index + 1];
      const mix = elapsed / FIXED_DT - index;
      positions.clear();
      for (let i = 0; i < a.balls.length; i += 3) {
        positions.set(a.balls[i], { x: a.balls[i + 1], y: a.balls[i + 2] });
      }
      for (let i = 0; i < b.balls.length; i += 3) {
        const id = b.balls[i];
        const prev = positions.get(id);
        const bx = b.balls[i + 1];
        const by = b.balls[i + 2];
        const x = prev ? prev.x + (bx - prev.x) * mix : bx;
        const y = prev ? prev.y + (by - prev.y) * mix : by;
        hooks.moveBall(id, x, y, true);
      }
    };
    app.ticker.add(tick);
  });
}
