import { Vector3 } from "three";

import type { BilliardsState } from "../../types";
import { aimedSnookerBall } from "../aimed-snooker-ball";
import type { AimTarget, SceneCallbacks } from "../scene-contract";
import type { createTableCamera } from "./camera";

export function createAimTargetPublisher(
  camera: ReturnType<typeof createTableCamera>,
  publish: SceneCallbacks["onAimTarget"],
) {
  const projection = new Vector3();
  let previous: AimTarget | null = null;
  return (state: BilliardsState | null, angle: number, enabled: boolean) => {
    const ball = enabled && state ? aimedSnookerBall(state, angle) : null;
    let next: AimTarget | null = null;
    if (ball) {
      projection.set(ball.x, 0, ball.y).project(camera.camera);
      next = {
        ballId: ball.id,
        x: Math.round((projection.x + 1) * 5000) / 100,
        y: Math.round((1 - projection.y) * 5000) / 100,
      };
    }
    if (
      next?.ballId === previous?.ballId &&
      next?.x === previous?.x &&
      next?.y === previous?.y
    )
      return;
    previous = next;
    publish?.(next);
  };
}
