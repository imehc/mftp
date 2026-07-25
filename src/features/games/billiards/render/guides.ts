/**
 * Aim guide geometry (pure math, no physics engine): sweep the cue ball
 * along the aim direction to its first contact — ball or cushion — and
 * derive the ghost-ball position, the object ball's departure line, and
 * the cue ball's tangent deflection.
 */
import { BALL_RADIUS, TABLE_H, TABLE_W } from "../constants";
import type { BallState } from "../types";

export interface Vec2 {
  x: number;
  y: number;
}

export interface AimGuide {
  cue: Vec2;
  dir: Vec2;
  /** Cue ball center at first contact (ghost ball) or cushion stop. */
  contact: Vec2;
  /** Object ball info when the first contact is a ball. */
  target: {
    id: number;
    center: Vec2;
    /** Unit direction the object ball will depart along. */
    dir: Vec2;
    /** 0..1 — how full the hit is (cos of the cut angle). */
    fullness: number;
  } | null;
  /** Unit direction of the cue ball after a ball contact (tangent). */
  cueDeflection: Vec2 | null;
}

export function computeAimGuide(
  balls: readonly BallState[],
  angle: number,
): AimGuide | null {
  const cueBall = balls.find((ball) => ball.id === 0 && !ball.potted);
  if (!cueBall) return null;
  const cue = { x: cueBall.x, y: cueBall.y };
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };

  // Nearest ball along the swept corridor.
  let tBall = Infinity;
  let hit: BallState | null = null;
  for (const ball of balls) {
    if (ball.potted || ball.id === 0) continue;
    const wx = ball.x - cue.x;
    const wy = ball.y - cue.y;
    const proj = wx * dir.x + wy * dir.y;
    if (proj <= 0) continue;
    const perpSq = wx * wx + wy * wy - proj * proj;
    const rr = BALL_RADIUS * 2;
    if (perpSq >= rr * rr) continue;
    const t = proj - Math.sqrt(rr * rr - perpSq);
    if (t < tBall) {
      tBall = t;
      hit = ball;
    }
  }

  // Cushion intersection (play area inset by the ball radius).
  const bx = TABLE_W / 2 - BALL_RADIUS;
  const by = TABLE_H / 2 - BALL_RADIUS;
  let tCushion = Infinity;
  if (Math.abs(dir.x) > 1e-9) {
    const t = ((dir.x > 0 ? bx : -bx) - cue.x) / dir.x;
    if (t > 0) tCushion = Math.min(tCushion, t);
  }
  if (Math.abs(dir.y) > 1e-9) {
    const t = ((dir.y > 0 ? by : -by) - cue.y) / dir.y;
    if (t > 0) tCushion = Math.min(tCushion, t);
  }
  if (!Number.isFinite(tCushion)) tCushion = 0;

  const t = Math.min(tBall, tCushion);
  const contact = { x: cue.x + dir.x * t, y: cue.y + dir.y * t };

  if (!hit || tBall > tCushion) {
    return { cue, dir, contact, target: null, cueDeflection: null };
  }

  const targetDirRaw = { x: hit.x - contact.x, y: hit.y - contact.y };
  const targetLen = Math.hypot(targetDirRaw.x, targetDirRaw.y) || 1;
  const targetDir = { x: targetDirRaw.x / targetLen, y: targetDirRaw.y / targetLen };
  const fullness = Math.max(0, dir.x * targetDir.x + dir.y * targetDir.y);

  // Cue ball keeps the tangent (perpendicular) velocity component.
  const tangent = {
    x: dir.x - fullness * targetDir.x,
    y: dir.y - fullness * targetDir.y,
  };
  const tangentLen = Math.hypot(tangent.x, tangent.y);
  const cueDeflection =
    tangentLen > 1e-6
      ? { x: tangent.x / tangentLen, y: tangent.y / tangentLen }
      : null;

  return {
    cue,
    dir,
    contact,
    target: {
      id: hit.id,
      center: { x: hit.x, y: hit.y },
      dir: targetDir,
      fullness,
    },
    cueDeflection,
  };
}
