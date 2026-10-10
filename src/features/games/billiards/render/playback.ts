/** 同一时间线驱动位置、碰撞音和下沉；取消时立即移除 ticker 并结束等待。 */
import type { Application, Container, Ticker } from "pixi.js";

import type { BilliardsPresentation, SimEvent } from "../types";
import { playImpactEvent } from "./audio";

export interface PlaybackHooks {
  moveBall(id: number, x: number, y: number, rolling: boolean): void;
  ballView(id: number): Container | undefined;
  maskPocket(id: number, pocket: number): void;
  onDone(): void;
}

export function runPresentation(
  app: Application,
  presentation: BilliardsPresentation,
  hooks: PlaybackHooks,
): { done: Promise<void>; cancel(): void } {
  const { frames, events } = presentation;
  let elapsed = 0;
  let eventIndex = 0;
  let frameIndex = 0;
  let finished = false;
  const drops = new Map<number, Extract<SimEvent, { type: "pocket" }>>();
  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const finish = () => {
    if (finished) return;
    finished = true;
    app.ticker.remove(tick);
    hooks.onDone();
    resolveDone();
  };

  const tick = (ticker: Ticker): void => {
    // 回到前台时不补播一长串碰撞；物理时间线以可见帧继续。
    elapsed += Math.min(ticker.deltaMS, 50) / 1000;
    while (eventIndex < events.length && events[eventIndex].t <= elapsed) {
      const event = events[eventIndex++];
      playImpactEvent(event);
      if (event.type === "pocket") {
        drops.set(event.ball, event);
        hooks.maskPocket(event.ball, event.pocket);
      }
    }
    while (
      frameIndex + 1 < frames.length &&
      frames[frameIndex + 1].t <= elapsed
    )
      frameIndex++;
    const a = frames[frameIndex];
    const b = frames[Math.min(frameIndex + 1, frames.length - 1)];
    const mix =
      b.t > a.t ? Math.min(1, Math.max(0, (elapsed - a.t) / (b.t - a.t))) : 1;
    const next = new Map<number, [number, number]>();
    for (let i = 0; i < b.balls.length; i += 3)
      next.set(b.balls[i], [b.balls[i + 1], b.balls[i + 2]]);
    for (let i = 0; i < a.balls.length; i += 3) {
      const id = a.balls[i];
      if (drops.has(id)) continue;
      const end = next.get(id);
      hooks.moveBall(
        id,
        a.balls[i + 1] + ((end?.[0] ?? a.balls[i + 1]) - a.balls[i + 1]) * mix,
        a.balls[i + 2] + ((end?.[1] ?? a.balls[i + 2]) - a.balls[i + 2]) * mix,
        true,
      );
    }
    let dropping = false;
    for (const [id, event] of drops) {
      const progress = Math.min(1, (elapsed - event.t) / 0.24);
      const view = hooks.ballView(id);
      if (!view) continue;
      // 保持原入射方向，衰减水平速度并下沉；不向袋心插值造成横向拐弯。
      const speed = Math.hypot(event.vx, event.vy);
      const travel = Math.min(0.032, speed * 0.045) * (1 - (1 - progress) ** 2);
      hooks.moveBall(
        id,
        event.x + (speed > 0 ? (event.vx / speed) * travel : 0),
        event.y + (speed > 0 ? (event.vy / speed) * travel : 0),
        true,
      );
      view.scale.set(1 - progress * 0.6);
      view.alpha = 1 - progress ** 2;
      view.visible = progress < 1;
      dropping ||= progress < 1;
    }
    if (
      elapsed >= frames[frames.length - 1].t &&
      eventIndex === events.length &&
      !dropping
    )
      finish();
  };

  if (frames.length === 0) finish();
  else app.ticker.add(tick);
  return { done, cancel: finish };
}
