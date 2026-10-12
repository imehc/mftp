import { SNOOKER } from "./equipment";
import {
  arrangementCandidates,
  circleIntersections,
  commonTangents,
  type Point2,
} from "./geometry-cells";
import { BAULK_X, D_RADIUS, insideD, isRed } from "./snooker-equipment";
import type { BallState, SnookerOn, SnookerState } from "./types";

export function ballsOn(balls: readonly BallState[], on: SnookerOn): number[] {
  return balls
    .filter(
      (ball) =>
        !ball.potted &&
        (on.kind === "red"
          ? isRed(ball.id)
          : on.kind === "color"
            ? ball.id === on.nominated
            : ball.id === on.color),
    )
    .map((ball) => ball.id);
}

function rayClear(
  cue: Point2,
  angle: number,
  length: number,
  obstacles: readonly BallState[],
): boolean {
  const dx = Math.cos(angle),
    dy = Math.sin(angle),
    diameter = SNOOKER.ballRadius * 2;
  return obstacles.every((ball) => {
    const x = ball.x - cue.x,
      y = ball.y - cue.y;
    const along = x * dx + y * dy;
    const across = x * dy - y * dx;
    if (along <= 0 || Math.abs(across) >= diameter - 1e-9) return true;
    return (
      along - Math.sqrt(Math.max(0, diameter ** 2 - across ** 2)) >=
      length - 1e-9
    );
  });
}

export function targetVisibility(
  cue: Point2,
  target: BallState,
  obstacles: readonly BallState[],
) {
  const distance = Math.hypot(target.x - cue.x, target.y - cue.y);
  const diameter = SNOOKER.ballRadius * 2;
  if (distance < diameter - 1e-8)
    return { bothEdges: false, any: false, full: false };
  const direction = Math.atan2(target.y - cue.y, target.x - cue.x);
  const half = Math.asin(Math.min(1, diameter / distance));
  const tangentLength = Math.sqrt(Math.max(0, distance ** 2 - diameter ** 2));
  const bothEdges = [-1, 1].every((side) =>
    rayClear(cue, direction + side * half, tangentLength, obstacles),
  );
  const full = rayClear(
    cue,
    direction,
    Math.max(0, distance - diameter),
    obstacles,
  );
  // 目标的角区间按障碍球切线分段，每段中点能见性恒定。
  const angles = [-half, half];
  for (const obstacle of obstacles) {
    const d = Math.hypot(obstacle.x - cue.x, obstacle.y - cue.y);
    const center = Math.atan2(
      Math.sin(Math.atan2(obstacle.y - cue.y, obstacle.x - cue.x) - direction),
      Math.cos(Math.atan2(obstacle.y - cue.y, obstacle.x - cue.x) - direction),
    );
    const spread = Math.asin(Math.min(1, diameter / Math.max(d, diameter)));
    for (const point of circleIntersections(
      { ...target, r: diameter },
      { ...obstacle, r: diameter },
    )) {
      const angle = Math.atan2(point.y - cue.y, point.x - cue.x) - direction;
      const edge = Math.atan2(Math.sin(angle), Math.cos(angle));
      if (edge > -half && edge < half) angles.push(edge);
    }
    for (const edge of [center - spread, center + spread])
      if (edge > -half && edge < half) angles.push(edge);
  }
  angles.sort((a, b) => a - b);
  const any =
    bothEdges ||
    full ||
    angles.slice(1).some((end, i) => {
      const offset = (angles[i] + end) / 2;
      const cross = distance * Math.sin(offset);
      const length =
        distance * Math.cos(offset) -
        Math.sqrt(Math.max(0, diameter ** 2 - cross ** 2));
      return rayClear(cue, direction + offset, length, obstacles);
    });
  return { bothEdges, any, full };
}

export function snookerVisibility(
  state: Pick<SnookerState, "balls" | "on">,
  cueOverride?: Point2,
) {
  const targets = ballsOn(state.balls, state.on);
  const cue =
    cueOverride ?? state.balls.find((ball) => ball.id === 0 && !ball.potted);
  if (!cue) return { bothEdges: false, any: false, full: false };
  const obstacles = state.balls.filter(
    (ball) => !ball.potted && ball.id !== 0 && !targets.includes(ball.id),
  );
  const sight = state.balls
    .filter((ball) => targets.includes(ball.id))
    .map((ball) => targetVisibility(cue, ball, obstacles));
  return {
    bothEdges: sight.some((v) => v.bothEdges),
    any: sight.some((v) => v.any),
    full: sight.some((v) => (state.on.kind === "red" ? v.bothEdges : v.full)),
  };
}

/** D区遍历公切线与放置边界的连续单元；候选位置从临界几何推导。 */
export function findDPlacement(
  balls: readonly BallState[],
  on?: SnookerOn,
): Point2 | null {
  const active = balls.filter((ball) => ball.id !== 0 && !ball.potted);
  const diameter = SNOOKER.ballRadius * 2;
  const legal = (point: Point2) =>
    insideD(point.x, point.y) &&
    active.every(
      (b) =>
        Math.hypot(b.x - point.x, b.y - point.y) >= diameter + 0.0001 - 1e-10,
    );
  const suitable = (point: Point2) =>
    legal(point) &&
    (!on || snookerVisibility({ balls: [...balls], on }, point).bothEdges);
  const center = { x: BAULK_X - D_RADIUS / 2, y: 0 };
  if (suitable(center)) return center;
  const targets: (number | null)[] = on ? ballsOn(balls, on) : [null];
  const circles = [
    { x: BAULK_X, y: 0, r: D_RADIUS },
    ...active.map((ball) => ({ ...ball, r: diameter + 0.0001 })),
  ];
  for (const targetId of targets) {
    const target = active.find((ball) => ball.id === targetId);
    const lines = [
      { nx: 1, ny: 0, c: BAULK_X },
      ...(target
        ? active
            .filter((ball) => !targets.includes(ball.id))
            .flatMap((ball) => commonTangents(target, ball, diameter))
        : []),
    ];
    for (const point of arrangementCandidates(
      circles,
      lines,
      (p) => Math.hypot(p.x - BAULK_X, p.y) <= D_RADIUS + 0.001,
    )) {
      if (suitable(point)) return point;
    }
  }
  return null;
}

export function freeBallAvailable(
  state: Pick<SnookerState, "balls" | "on" | "placementRegion">,
): boolean {
  if (state.placementRegion === "table") return false;
  if (state.placementRegion === "d")
    return findDPlacement(state.balls, state.on) === null;
  return !snookerVisibility(state).bothEdges;
}

/** 按最近障碍球（等距并列）判定有效球；不同红球的有效障碍不同则没有有效球。 */
export function snookeredBy(
  state: Pick<SnookerState, "balls" | "on">,
  id: number,
): boolean {
  const cue = state.balls.find((ball) => ball.id === 0 && !ball.potted);
  if (!cue) return false;
  const targets = ballsOn(state.balls, state.on);
  const obstacles = state.balls.filter(
    (ball) => ball.id !== 0 && !ball.potted && !targets.includes(ball.id),
  );
  let common: number[] | null = null;
  for (const target of state.balls.filter((ball) =>
    targets.includes(ball.id),
  )) {
    const blocking = obstacles.filter(
      (ball) => !targetVisibility(cue, target, [ball]).bothEdges,
    );
    if (!blocking.length) return false;
    const nearest = Math.min(
      ...blocking.map((ball) => Math.hypot(ball.x - cue.x, ball.y - cue.y)),
    );
    const effective = blocking
      .filter(
        (ball) => Math.hypot(ball.x - cue.x, ball.y - cue.y) <= nearest + 1e-8,
      )
      .map((ball) => ball.id);
    common =
      common === null
        ? effective
        : common.filter((ballId) => effective.includes(ballId));
  }
  return common?.includes(id) ?? false;
}
