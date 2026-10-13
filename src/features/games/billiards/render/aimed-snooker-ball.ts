import { SNOOKER } from "../equipment";
import { guideClearance } from "../geometry";
import type { BallState, BilliardsState } from "../types";

export function aimedSnookerBall(
  state: BilliardsState,
  angle: number,
): BallState | null {
  if (state.variant !== "snooker" || state.finished || state.ballInHand)
    return null;
  const cue = state.balls.find((ball) => ball.id === 0 && !ball.potted);
  if (!cue) return null;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const diameter = SNOOKER.ballRadius * 2;
  let distance = guideClearance(cue, direction, [], [], Infinity, SNOOKER);
  let target: BallState | null = null;
  for (const ball of state.balls) {
    if (ball.id === 0 || ball.potted) continue;
    const deltaX = ball.x - cue.x;
    const deltaY = ball.y - cue.y;
    const projection = deltaX * direction.x + deltaY * direction.y;
    const cross = deltaX * direction.y - deltaY * direction.x;
    const discriminant = diameter * diameter - cross * cross;
    if (projection < 0 || discriminant < 0) continue;
    const contact = Math.max(0, projection - Math.sqrt(discriminant));
    if (
      contact < distance ||
      (contact === distance && target && ball.id < target.id)
    ) {
      distance = contact;
      target = ball;
    }
  }
  return target;
}
