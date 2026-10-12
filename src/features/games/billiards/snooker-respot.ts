import { SNOOKER } from "./equipment";
import { nearestLineSpot } from "./placement";
import { COLOR_IDS, COLOR_SPOTS } from "./snooker-equipment";
import type { BallState } from "./types";

/** 彩球逐个按分值降序复位；后复位的球必须看到前一颗已占用的点。 */
export function respotColors(
  source: readonly BallState[],
  ids: readonly number[],
): BallState[] {
  let balls = source.map((ball) => ({ ...ball }));
  for (const id of [...new Set(ids)].sort((a, b) => b - a)) {
    const clear = (spot: { x: number; y: number }) =>
      balls.every(
        (ball) =>
          ball.id === id ||
          ball.potted ||
          Math.hypot(ball.x - spot.x, ball.y - spot.y) >=
            SNOOKER.ballRadius * 2 + 0.0001,
      );
    const own = COLOR_SPOTS[id];
    if (!own) throw new Error("billiards: invalid snooker colour");
    let spot: { x: number; y: number } | undefined | null = clear(own)
      ? own
      : [...COLOR_IDS]
          .reverse()
          .map((color) => COLOR_SPOTS[color])
          .find(clear);
    const limit = SNOOKER.tableWidth / 2 - SNOOKER.ballRadius;
    if (!spot)
      spot = nearestLineSpot(
        balls,
        id,
        own.x,
        limit,
        own.y,
        SNOOKER,
        () => 0.0001,
      );
    if (!spot && (id === 6 || id === 7))
      spot = nearestLineSpot(
        balls,
        id,
        own.x,
        -limit,
        0,
        SNOOKER,
        () => 0.0001,
      );
    if (!spot) throw new Error("billiards: no legal snooker colour spot");
    balls = balls.map((ball) =>
      ball.id === id ? { ...ball, ...spot, potted: false } : ball,
    );
  }
  return balls;
}
