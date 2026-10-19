/**
 * 球位几何：落点是否在台面内、是否与其他球重叠。
 *
 * 这些判定必须留在主线程（放置母球、规则校验要同步得到结果），
 * 因此单独成模块，不引入物理引擎——否则会连同 rapier 一起被打进
 * 主线程产物。模拟 worker 与主线程共用同一套规则。
 */
import { CHINESE_EIGHT, type TableEquipment } from "./equipment";
import type { BallState } from "./types";

export function overlapsAnyBall(
  balls: readonly BallState[],
  x: number,
  y: number,
  ignoreId?: number,
  equipment: TableEquipment = CHINESE_EIGHT,
): boolean {
  return balls.some(
    (b) =>
      !b.potted &&
      b.id !== ignoreId &&
      Math.hypot(b.x - x, b.y - y) < equipment.ballRadius * 2 + 0.0001,
  );
}

export function insidePlayArea(
  x: number,
  y: number,
  equipment: TableEquipment = CHINESE_EIGHT,
): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) <= equipment.tableWidth / 2 - equipment.ballRadius &&
    Math.abs(y) <= equipment.tableHeight / 2 - equipment.ballRadius
  );
}
