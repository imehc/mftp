import type { TableEquipment } from "../../equipment";
import type { BallState } from "../../types";
import { CUE_APPEARANCE, cueRadius } from "./cue-appearance";

export const CUE_PULL_DISTANCE = 0.28;
export const CUE_CONTACT_PULL = -0.018;
export const CUE_FOLLOW_THROUGH = -0.16;
export const CUE_TIP_GAP = 0.005;

type Coordinates = readonly [number, number, number];

interface CueSweep {
  start: number;
  end: number;
  radius: number;
}

interface FrameBounds {
  min: Coordinates;
  max: Coordinates;
}

function intersectsFrame(
  origin: Coordinates,
  direction: Coordinates,
  sweep: CueSweep,
  frame: FrameBounds,
  entrance: number,
) {
  let enter = sweep.start;
  let leave = sweep.end + entrance;
  for (let axis = 0; axis < 3; axis++) {
    const lower = frame.min[axis] - sweep.radius - origin[axis];
    const upper = frame.max[axis] + sweep.radius - origin[axis];
    const speed = direction[axis];
    if (Math.abs(speed) < 1e-12) {
      if (lower > 0 || upper < 0) return false;
      continue;
    }
    const first = lower / speed;
    const second = upper / speed;
    enter = Math.max(enter, Math.min(first, second));
    leave = Math.min(leave, Math.max(first, second));
    if (enter > leave) return false;
  }
  return true;
}

export function createCueClearance(equipment: TableEquipment) {
  const rest = equipment.ballRadius + CUE_TIP_GAP;
  const forward = rest + CUE_FOLLOW_THROUGH * CUE_PULL_DISTANCE;
  const backward = rest + CUE_PULL_DISTANCE;
  const clearance = 0.002;
  let start = 0;
  const sweeps = CUE_APPEARANCE[equipment.id].bands.map((band) => {
    const sweep = {
      start: forward + start * equipment.cueLength,
      end: backward + band.end * equipment.cueLength,
      radius: cueRadius(equipment, band.end) + clearance,
    };
    start = band.end;
    return sweep;
  });
  const halfWidth = equipment.tableWidth / 2;
  const halfHeight = equipment.tableHeight / 2;
  const border = equipment.cushionWidth + equipment.frameWidth;
  const outerWidth = halfWidth + border;
  const outerHeight = halfHeight + border;
  const top = equipment.cushionHeight + 0.002;
  const frames: FrameBounds[] = [
    {
      min: [-outerWidth, -0.065, -outerHeight],
      max: [-halfWidth, top, outerHeight],
    },
    {
      min: [halfWidth, -0.065, -outerHeight],
      max: [outerWidth, top, outerHeight],
    },
    {
      min: [-outerWidth, -0.065, -outerHeight],
      max: [outerWidth, top, -halfHeight],
    },
    {
      min: [-outerWidth, -0.065, halfHeight],
      max: [outerWidth, top, outerHeight],
    },
  ];

  return (
    x: number,
    z: number,
    angle: number,
    balls: readonly BallState[],
    entrance = 0,
  ) => {
    const origin: Coordinates = [x, equipment.ballRadius, z];
    const backX = -Math.cos(angle);
    const backZ = -Math.sin(angle);
    const obstacles = balls.filter((ball) => ball.id !== 0 && !ball.potted);

    const collides = (elevation: number) => {
      const horizontal = Math.cos(elevation);
      const direction: Coordinates = [
        backX * horizontal,
        Math.sin(elevation),
        backZ * horizontal,
      ];
      for (const sweep of sweeps) {
        for (const ball of obstacles) {
          const offsetX = ball.x - x;
          const offsetZ = ball.y - z;
          const projection = offsetX * direction[0] + offsetZ * direction[2];
          const along = Math.max(
            sweep.start,
            Math.min(sweep.end + entrance, projection),
          );
          const distanceSquared =
            offsetX ** 2 + offsetZ ** 2 + along ** 2 - 2 * along * projection;
          if (distanceSquared < (equipment.ballRadius + sweep.radius) ** 2)
            return true;
        }
        for (const frame of frames)
          if (intersectsFrame(origin, direction, sweep, frame, entrance))
            return true;
      }
      return false;
    };

    let lower = Math.PI / 30;
    if (!collides(lower)) return lower;
    let upper = Math.PI / 2;
    // 按整个拉杆至随挥范围求解，避免杆身随蓄力反复抬落或插入障碍物。
    for (let iteration = 0; iteration < 18; iteration++) {
      const middle = (lower + upper) / 2;
      if (collides(middle)) lower = middle;
      else upper = middle;
    }
    return upper;
  };
}
