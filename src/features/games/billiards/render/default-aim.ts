import { CHINESE_EIGHT, type TableEquipment } from "../equipment";
import { guideClearance } from "../geometry";
import { targetBallIds } from "../targets";
import type { BilliardsState } from "../types";

/** 优先直击最近的合法球；距离相同时按球号，避免遍历顺序改变朝向。 */
export function defaultAim(
  state: BilliardsState,
  equipment: TableEquipment = CHINESE_EIGHT,
): { angle: number; targetId: number } | null {
  const BALL_RADIUS = equipment.ballRadius;
  if (state.finished || state.ballInHand) return null;
  const cue = state.balls.find((ball) => ball.id === 0 && !ball.potted);
  if (!cue) return null;
  const legal = targetBallIds(state, state.turnSeat);
  const candidates = state.balls
    .filter((ball) => legal.includes(ball.id))
    .map((ball) => ({
      ball,
      distance: Math.hypot(ball.x - cue.x, ball.y - cue.y),
    }))
    .sort((a, b) => a.distance - b.distance || a.ball.id - b.ball.id);
  // 斯诺克开球时粉球挡在红球堆正前，没有任何一条直线完全畅通；此时
  // 退回到被遮挡最少的目标，球杆仍指向最近的合法红球，辅助线由真实
  // 物理算首碰。中式/九球的既有语义是“全被挡住就不强加朝向”，保持 null。
  let fallback: { angle: number; targetId: number; open: number } | null = null;
  for (const { ball, distance } of candidates) {
    if (distance < BALL_RADIUS * 2 - 1e-6) continue;
    const dir = {
      x: (ball.x - cue.x) / distance,
      y: (ball.y - cue.y) / distance,
    };
    const contactDistance = Math.max(0, distance - BALL_RADIUS * 2);
    // 扫掠母球圆面到目标接触点，连袋口与库边也不能穿越。
    const clearance = guideClearance(
      cue,
      dir,
      state.balls,
      [0, ball.id],
      contactDistance,
      equipment,
    );
    const angle = Math.atan2(dir.y, dir.x);
    if (clearance + 1e-6 >= contactDistance)
      return { angle, targetId: ball.id };
    if (state.variant !== "snooker") continue;
    const open = contactDistance > 0 ? clearance / contactDistance : 0;
    if (!fallback || open > fallback.open + 1e-9)
      fallback = { angle, targetId: ball.id, open };
  }
  return fallback && { angle: fallback.angle, targetId: fallback.targetId };
}

/** 每个可操作局面只初始化一次，普通重渲染和拖动不会抢走玩家的瞄准。 */
export function createDefaultAim(equipment: TableEquipment = CHINESE_EIGHT) {
  let previous: string | null = null;
  return {
    update(state: BilliardsState, ready: boolean): number | null {
      if (!ready || state.ballInHand || state.finished) {
        previous = null;
        return null;
      }
      const key = JSON.stringify([
        state.shotCount,
        state.turnSeat,
        state.variant,
        state.variant === "snooker"
          ? [state.on, state.nominatedFree]
          : state.variant === "nine-ball"
            ? state.decision
            : state.openTable,
        state.variant === "nine-ball" || state.variant === "snooker"
          ? null
          : state.groups,
        state.balls.map(({ id, x, y, potted }) => [id, x, y, potted]),
      ]);
      if (key === previous) return null;
      previous = key;
      return defaultAim(state, equipment)?.angle ?? null;
    },
  };
}
