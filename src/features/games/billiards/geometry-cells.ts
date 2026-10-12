/** 圆/直线排列的边界分段用于连续可行域求解，不用固定格点宣称区域无解。 */
export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Line {
  nx: number;
  ny: number;
  c: number;
}

export interface Point2 {
  x: number;
  y: number;
}

function lineCircle(line: Line, circle: Circle): Point2[] {
  const d = line.nx * circle.x + line.ny * circle.y - line.c;
  if (Math.abs(d) > circle.r + 1e-10) return [];
  const length = Math.sqrt(Math.max(0, circle.r ** 2 - d ** 2));
  const x = circle.x - line.nx * d;
  const y = circle.y - line.ny * d;
  return [
    { x: x - line.ny * length, y: y + line.nx * length },
    { x: x + line.ny * length, y: y - line.nx * length },
  ];
}

export function circleIntersections(a: Circle, b: Circle): Point2[] {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    d = Math.hypot(dx, dy);
  if (d < 1e-12 || d > a.r + b.r + 1e-10 || d < Math.abs(a.r - b.r) - 1e-10)
    return [];
  const along = (a.r ** 2 - b.r ** 2 + d ** 2) / (2 * d);
  const height = Math.sqrt(Math.max(0, a.r ** 2 - along ** 2));
  const x = a.x + (dx * along) / d,
    y = a.y + (dy * along) / d;
  return [
    { x: x - (dy * height) / d, y: y + (dx * height) / d },
    { x: x + (dy * height) / d, y: y - (dx * height) / d },
  ];
}

export function* arrangementCandidates(
  circles: readonly Circle[],
  lines: readonly Line[],
  inBounds: (p: Point2) => boolean,
): Generator<Point2> {
  const circlePoints = circles.map(() => [] as Point2[]);
  const linePoints = lines.map(() => [] as Point2[]);
  for (let i = 0; i < circles.length; i++)
    for (let j = i + 1; j < circles.length; j++) {
      const points = circleIntersections(circles[i], circles[j]);
      circlePoints[i].push(...points);
      circlePoints[j].push(...points);
    }
  for (let i = 0; i < lines.length; i++) {
    for (let j = 0; j < circles.length; j++) {
      const points = lineCircle(lines[i], circles[j]);
      linePoints[i].push(...points);
      circlePoints[j].push(...points);
    }
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i],
        b = lines[j];
      const determinant = a.nx * b.ny - a.ny * b.nx;
      if (Math.abs(determinant) < 1e-12) continue;
      const point = {
        x: (a.c * b.ny - a.ny * b.c) / determinant,
        y: (a.nx * b.c - a.c * b.nx) / determinant,
      };
      linePoints[i].push(point);
      linePoints[j].push(point);
    }
  }

  function* adjacent(
    p: Point2,
    normal: Point2,
    skipCircle: number,
    skipLine: number,
  ) {
    if (!inBounds(p)) return;
    yield p;
    let clearance = 0.0001;
    for (const [i, circle] of circles.entries()) {
      if (i === skipCircle) continue;
      const distance = Math.abs(
        Math.hypot(p.x - circle.x, p.y - circle.y) - circle.r,
      );
      if (distance > 1e-11) clearance = Math.min(clearance, distance / 4);
    }
    for (const [i, line] of lines.entries()) {
      if (i === skipLine) continue;
      const distance = Math.abs(line.nx * p.x + line.ny * p.y - line.c);
      if (distance > 1e-11) clearance = Math.min(clearance, distance / 4);
    }
    for (const sign of [-1, 1])
      yield {
        x: p.x + sign * normal.x * clearance,
        y: p.y + sign * normal.y * clearance,
      };
  }

  for (const [i, circle] of circles.entries()) {
    const angles = [
      0,
      ...circlePoints[i].map((p) => Math.atan2(p.y - circle.y, p.x - circle.x)),
    ].sort((a, b) => a - b);
    for (let j = 0; j < angles.length; j++) {
      const next =
        j + 1 < angles.length ? angles[j + 1] : angles[0] + Math.PI * 2;
      const angle = (angles[j] + next) / 2;
      const normal = { x: Math.cos(angle), y: Math.sin(angle) };
      yield* adjacent(
        {
          x: circle.x + normal.x * circle.r,
          y: circle.y + normal.y * circle.r,
        },
        normal,
        i,
        -1,
      );
    }
    for (const p of circlePoints[i]) if (inBounds(p)) yield p;
  }
  for (const [i, line] of lines.entries()) {
    const points = linePoints[i].sort(
      (a, b) => -line.ny * (a.x - b.x) + line.nx * (a.y - b.y),
    );
    for (let j = 1; j < points.length; j++) {
      yield* adjacent(
        {
          x: (points[j - 1].x + points[j].x) / 2,
          y: (points[j - 1].y + points[j].y) / 2,
        },
        { x: line.nx, y: line.ny },
        -1,
        i,
      );
    }
  }
}

/** 等半径球的四条公切线是极薄边能见性变化的临界线。 */
export function commonTangents(a: Point2, b: Point2, radius: number): Line[] {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    distance = Math.hypot(dx, dy);
  if (distance < 1e-12) return [];
  const lines: Line[] = [];
  for (const sign of [-1, 1]) {
    const projection = (sign * radius - radius) / distance;
    if (Math.abs(projection) > 1) continue;
    const perpendicular = Math.sqrt(Math.max(0, 1 - projection ** 2));
    for (const side of [-1, 1]) {
      const nx =
        (dx / distance) * projection - (dy / distance) * perpendicular * side;
      const ny =
        (dy / distance) * projection + (dx / distance) * perpendicular * side;
      lines.push({ nx, ny, c: nx * a.x + ny * a.y - radius });
    }
  }
  // 膨胀圆相交时，目标切点跨过障碍边界也会改变极薄边的先后接触。
  for (const point of circleIntersections(
    { ...a, r: radius },
    { ...b, r: radius },
  )) {
    const nx = (point.x - a.x) / radius,
      ny = (point.y - a.y) / radius;
    lines.push({ nx, ny, c: nx * point.x + ny * point.y });
  }
  return lines;
}
