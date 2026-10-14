import { ExtrudeGeometry, Path, Shape, Vector2 } from "three";

import type { TableEquipment } from "../../equipment";
import type { BallState, BilliardsState } from "../../types";

function hull(points: Vector2[]) {
  const sorted = [...points].sort((first, second) =>
    first.x === second.x ? first.y - second.y : first.x - second.x,
  );
  const cross = (origin: Vector2, first: Vector2, second: Vector2) =>
    (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x);

  const chain = (vertices: Vector2[]) => {
    const result: Vector2[] = [];
    for (const point of vertices) {
      while (
        result.length > 1 &&
        cross(result[result.length - 2], result[result.length - 1], point) <= 0
      )
        result.pop();
      result.push(point);
    }
    result.pop();
    return result;
  };

  return [...chain(sorted), ...chain([...sorted].reverse())];
}

function roundedContour(vertices: Vector2[], distance: number) {
  const points: Vector2[] = [];
  for (const [index, vertex] of vertices.entries()) {
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    const next = vertices[(index + 1) % vertices.length];
    const before = new Vector2(
      vertex.y - previous.y,
      previous.x - vertex.x,
    ).normalize();
    const after = new Vector2(next.y - vertex.y, vertex.x - next.x).normalize();
    const start = Math.atan2(before.y, before.x);
    let end = Math.atan2(after.y, after.x);
    while (end <= start) end += Math.PI * 2;
    for (let step = 0; step <= 8; step++) {
      const angle = start + ((end - start) * step) / 8;
      points.push(
        new Vector2(
          vertex.x + Math.cos(angle) * distance,
          vertex.y + Math.sin(angle) * distance,
        ),
      );
    }
  }
  return points;
}

export function rackLayout(equipment: TableEquipment, state: BilliardsState) {
  if (equipment.id === "snooker") return null;
  const balls = state.balls.filter((ball) => !ball.potted && ball.id !== 0);
  if (balls.length < 3) return null;
  const radius = equipment.ballRadius;
  const vertices = hull(balls.map((ball) => new Vector2(ball.x, ball.y)));
  if (vertices.length < 3) return null;
  const inner = roundedContour(vertices, radius * 1.08);
  const outer = roundedContour(vertices, radius * 1.46);
  const minimumX = Math.min(...outer.map((point) => point.x));
  const maximumX = Math.max(...outer.map((point) => point.x));
  const minimumZ = Math.min(...outer.map((point) => point.y));
  const maximumZ = Math.max(...outer.map((point) => point.y));
  const moving = new Set(balls.map((ball) => ball.id));
  const stationary = state.balls.filter(
    (ball) => !ball.potted && !moving.has(ball.id),
  );
  let pushDistance = Math.min(
    radius * 2.4,
    minimumX + equipment.tableWidth / 2 - radius * 0.2,
  );
  for (const ball of balls) {
    for (const fixed of stationary) {
      const lateral = Math.abs(ball.y - fixed.y);
      if (fixed.x >= ball.x || lateral >= radius * 2.1) continue;
      const gap =
        ball.x - fixed.x - Math.sqrt((radius * 2.1) ** 2 - lateral ** 2);
      pushDistance = Math.min(pushDistance, gap - radius * 0.1);
    }
  }
  for (const point of outer) {
    for (const fixed of stationary) {
      const lateral = Math.abs(point.y - fixed.y);
      if (fixed.x >= point.x || lateral >= radius * 1.1) continue;
      const gap =
        point.x - fixed.x - Math.sqrt((radius * 1.1) ** 2 - lateral ** 2);
      pushDistance = Math.min(pushDistance, gap - radius * 0.1);
    }
  }
  pushDistance = Math.max(0, pushDistance);
  return {
    balls,
    inner,
    outer,
    pushDistance,
    radius,
    focus: {
      x: (minimumX + maximumX - pushDistance) / 2,
      z: (minimumZ + maximumZ) / 2,
      halfWidth: (maximumX - minimumX + pushDistance) / 2 + radius * 2,
      halfHeight: (maximumZ - minimumZ) / 2 + radius * 2,
      ceiling: radius * 6,
    },
  };
}

export type RackLayout = NonNullable<ReturnType<typeof rackLayout>>;

export function rackGeometry(layout: RackLayout) {
  const shape = new Shape(layout.outer);
  shape.holes.push(new Path([...layout.inner].reverse()));
  const geometry = new ExtrudeGeometry(shape, {
    depth: layout.radius * 0.7,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: layout.radius * 0.035,
    bevelThickness: layout.radius * 0.035,
    steps: 1,
    curveSegments: 8,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, layout.radius * 0.85, 0);
  return geometry;
}

export function rackBallPositions(
  layout: RackLayout,
  progress: number,
): BallState[] {
  const offset =
    -layout.pushDistance * (1 - Math.max(0, Math.min(1, progress)));
  return layout.balls.map((ball) => ({ ...ball, x: ball.x + offset }));
}
