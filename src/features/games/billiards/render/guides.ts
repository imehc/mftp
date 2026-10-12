import { CHINESE_EIGHT, type TableEquipment } from "../equipment";
/** 指示线取自同参数物理模拟；保留正常的摩擦偏转和杆法影响。 */
import { guideClearance } from "../geometry";
import { simulateShot, type Vec2 } from "../physics";
import type { BallState } from "../types";

export type { Vec2 } from "../physics";

export interface AimGuide {
  cue: Vec2;
  dir: Vec2;
  contact: Vec2;
  target: {
    id: number;
    center: Vec2;
    dir: Vec2;
    fullness: number;
    length: number;
  } | null;
  cueDeflection: Vec2 | null;
  cueLength: number;
}

function direction(velocity: Vec2 | null): Vec2 | null {
  if (!velocity) return null;
  const speed = Math.hypot(velocity.x, velocity.y);
  return speed > 0.008
    ? { x: velocity.x / speed, y: velocity.y / speed }
    : null;
}

export function computeAimGuide(
  balls: readonly BallState[],
  angle: number,
  followDraw = 0,
  power = 0.5,
  equipment: TableEquipment = CHINESE_EIGHT,
): AimGuide | null {
  const cue = balls.find((b) => b.id === 0 && !b.potted);
  if (!cue) return null;
  const sim = simulateShot(
    balls,
    { angle, power, followDraw },
    true,
    equipment,
  );
  const impact = sim.firstImpact;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const cueEnd = sim.balls.find((b) => b.id === 0)!;
  const pocket = sim.events.find((e) => e.type === "pocket" && e.ball === 0);
  const contact =
    impact?.cue ??
    (pocket?.type === "pocket"
      ? { x: pocket.x, y: pocket.y }
      : { x: cueEnd.x, y: cueEnd.y });
  const targetDir = direction(impact?.targetVelocity ?? null);
  const deflection = direction(impact?.cueVelocity ?? null);
  const target =
    impact?.target && impact.targetId !== null && targetDir
      ? {
          id: impact.targetId,
          center: impact.target,
          dir: targetDir,
          fullness: Math.max(0, dir.x * targetDir.x + dir.y * targetDir.y),
          length: guideClearance(
            impact.target,
            targetDir,
            balls,
            [0, impact.targetId],
            0.5,
            equipment,
          ),
        }
      : null;
  return {
    cue: { x: cue.x, y: cue.y },
    dir,
    contact,
    target,
    cueDeflection: deflection,
    cueLength: deflection
      ? guideClearance(
          contact,
          deflection,
          balls,
          [0, ...(target ? [target.id] : [])],
          0.3,
          equipment,
        )
      : 0,
  };
}
