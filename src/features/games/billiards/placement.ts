import {
  AMERICAN_NINE,
  CHINESE_EIGHT,
  SNOOKER,
  type TableEquipment,
} from "./equipment";
import { insidePlayArea, overlapsAnyBall } from "./physics";
import { insideD } from "./snooker-equipment";
import type { BallState, BilliardsState } from "./types";

export function equipmentForState(state: BilliardsState): TableEquipment {
  if (
    state.variant === "snooker" ||
    (state.variant === "practice" && state.discipline === "snooker")
  )
    return SNOOKER;
  return state.variant === "nine-ball" ||
    (state.variant === "practice" && state.discipline === "nine-ball")
    ? AMERICAN_NINE
    : CHINESE_EIGHT;
}

/** 放置预览、提交和AI共用区域；放置完成只结束拖动，不消费本杆放置权。 */
export function legalCuePlacement(
  state: BilliardsState,
  x: number,
  y: number,
): boolean {
  const equipment = equipmentForState(state);
  return (
    insidePlayArea(x, y, equipment) &&
    !overlapsAnyBall(state.balls, x, y, 0, equipment) &&
    (state.variant !== "nine-ball" ||
      state.placementRegion !== "head" ||
      x < -equipment.tableWidth / 4) &&
    (state.variant !== "snooker" ||
      state.placementRegion !== "d" ||
      insideD(x, y))
  );
}

/** 沿固定横线求球心占用区间的边界；没有合法点时明确失败，不落回台心。 */
export function nearestLineSpot(
  balls: readonly BallState[],
  ignoreId: number,
  start: number,
  end: number,
  y: number,
  equipment: TableEquipment,
  gap: (id: number) => number,
): { x: number; y: number } | null {
  const sign = end >= start ? 1 : -1;
  const occupied = balls.filter((ball) => !ball.potted && ball.id !== ignoreId);
  const candidates = [
    start,
    ...occupied.flatMap((ball) => {
      const radius = equipment.ballRadius * 2 + gap(ball.id);
      const dy = ball.y - y;
      if (Math.abs(dy) > radius) return [];
      const extent = Math.sqrt(Math.max(0, radius * radius - dy * dy));
      return [ball.x - extent, ball.x + extent];
    }),
  ]
    .filter((x) => sign * (x - start) >= -1e-10 && sign * (end - x) >= -1e-10)
    .sort((a, b) => sign * (a - b));
  for (const x of candidates) {
    if (
      insidePlayArea(x, y, equipment) &&
      occupied.every(
        (ball) =>
          Math.hypot(ball.x - x, ball.y - y) >=
          equipment.ballRadius * 2 + gap(ball.id) - 1e-10,
      )
    )
      return { x, y };
  }
  return null;
}

/** WPA复位优先朝脚库，整段被占后才朝头库；允许贴目标球，不贴母球。 */
export function respotNine(balls: readonly BallState[]): BallState[] {
  const equipment = AMERICAN_NINE;
  const foot = equipment.tableWidth / 4;
  const limit = equipment.tableWidth / 2 - equipment.ballRadius;
  const gap = (id: number) => (id === 0 ? 0.0001 : 0);
  const spot =
    nearestLineSpot(balls, 9, foot, limit, 0, equipment, gap) ??
    nearestLineSpot(balls, 9, foot, -limit, 0, equipment, gap);
  if (!spot) throw new Error("billiards: no legal nine-ball spot");
  return balls.map((ball) =>
    ball.id === 9 ? { ...ball, ...spot, potted: false } : ball,
  );
}
