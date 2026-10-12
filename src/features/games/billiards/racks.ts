import { createRng } from "../engine/ai";
import { AMERICAN_NINE } from "./equipment";
import type { BallState } from "./types";

/** 九球紧密菱形：9号在脚点，随机种子在对局创建时固定。 */
export function createNineBallRack(seed: number): BallState[] {
  const diameter = AMERICAN_NINE.ballRadius * 2;
  const rowStep = (diameter * Math.sqrt(3)) / 2;
  const foot = AMERICAN_NINE.tableWidth / 4;
  const rng = createRng(seed);
  const remaining = [2, 3, 4, 5, 6, 7, 8];
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }
  const balls: BallState[] = [{ id: 0, x: -foot - 0.1, y: 0, potted: false }];
  for (const [row, count] of [1, 2, 3, 2, 1].entries()) {
    for (let col = 0; col < count; col++) {
      const id = row === 0 ? 1 : row === 2 && col === 1 ? 9 : remaining.pop()!;
      balls.push({
        id,
        x: foot + (row - 2) * rowStep,
        y: (col - (count - 1) / 2) * diameter,
        potted: false,
      });
    }
  }
  return balls.sort((a, b) => a.id - b.id);
}
