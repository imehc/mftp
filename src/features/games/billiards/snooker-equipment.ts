import { createRng } from "../engine/ai";
import { SNOOKER } from "./equipment";
import type { BallState, RedCount } from "./types";

export const BAULK_X = -1.0475;
export const D_RADIUS = 0.292;
export const COLOR_IDS = [2, 3, 4, 5, 6, 7] as const;
export const COLOR_SPOTS: Readonly<Record<number, { x: number; y: number }>> = {
  2: { x: BAULK_X, y: D_RADIUS },
  3: { x: BAULK_X, y: -D_RADIUS },
  4: { x: BAULK_X, y: 0 },
  5: { x: 0, y: 0 },
  6: { x: 0.89225, y: 0 },
  7: { x: 1.4605, y: 0 },
};

export const isRed = (id: number) => id >= 8;
export const snookerValue = (id: number) => (id === 0 ? 0 : isRed(id) ? 1 : id);

export function insideD(x: number, y: number): boolean {
  return x <= BAULK_X + 1e-10 && Math.hypot(x - BAULK_X, y) <= D_RADIUS + 1e-10;
}

/**
 * 斯诺克摆球：彩球固定点位；红球紧靠粉球后方摆成三角形，底边平行顶库，
 * 球间贴紧。红球没有号码顺序，按种子随机分配 id 只是为了让每局外观
 * 不同，不影响规则。
 */
export function createSnookerRack(reds: RedCount, seed = 1): BallState[] {
  const diameter = SNOOKER.ballRadius * 2;
  const balls: BallState[] = [
    { id: 0, x: BAULK_X - D_RADIUS / 2, y: D_RADIUS / 2, potted: false },
    ...COLOR_IDS.map((id) => ({ id, ...COLOR_SPOTS[id], potted: false })),
  ];
  const rows = reds === 6 ? 3 : reds === 10 ? 4 : 5;
  const rng = createRng(seed);
  const ids = Array.from({ length: reds }, (_, i) => 8 + i);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  for (let row = 0; row < rows; row++)
    for (let col = 0; col <= row; col++) {
      balls.push({
        id: ids.pop()!,
        x:
          COLOR_SPOTS[6].x +
          diameter +
          0.0001 +
          (row * diameter * Math.sqrt(3)) / 2,
        y: (col - row / 2) * diameter,
        potted: false,
      });
    }
  return balls.sort((a, b) => a.id - b.id);
}
