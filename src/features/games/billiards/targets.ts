import type { SeatIndex } from "../engine/types";
import { ballsOn } from "./snooker-visibility";
import { ballGroup, type BilliardsState, remainingGroupBalls } from "./types";

/** AI 与默认瞄准共用资格判断；选择目标不等于自动决定击球策略。 */
export function targetBallIds(
  state: BilliardsState,
  seat: SeatIndex,
): number[] {
  const alive = state.balls.filter((ball) => !ball.potted && ball.id !== 0);
  if (state.variant === "practice") return alive.map((ball) => ball.id);
  if (state.variant === "snooker")
    return state.nominatedFree !== null
      ? [state.nominatedFree]
      : ballsOn(state.balls, state.on);
  if (state.variant === "nine-ball")
    return alive.length ? [Math.min(...alive.map((ball) => ball.id))] : [];
  const group = state.groups[seat];
  if (state.openTable || group == null)
    return alive.filter((ball) => ball.id !== 8).map((ball) => ball.id);
  if (remainingGroupBalls(state, group) === 0)
    return alive.filter((ball) => ball.id === 8).map((ball) => ball.id);
  return alive
    .filter((ball) => ballGroup(ball.id) === group)
    .map((ball) => ball.id);
}
