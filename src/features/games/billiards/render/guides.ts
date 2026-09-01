/**
 * 瞄准辅助几何（纯数学，无物理引擎）：沿瞄准方向扫描母球直到首次接触——
 * 球或库边——并推导出虚拟球位置、目标球的离开方向，以及母球的偏转
 * （与 physics 的恢复系数 + 旋转模型一致）。
 */
import {
  BALL_RADIUS,
  BALL_RESTITUTION,
  FOLLOW_DRAW_FACTOR,
  TABLE_H,
  TABLE_W,
} from "../constants";
import type { BallState } from "../types";

export interface Vec2 {
  x: number;
  y: number;
}

export interface AimGuide {
  cue: Vec2;
  dir: Vec2;
  /** 首次接触时母球中心（虚拟球）或停在库边处。 */
  contact: Vec2;
  /** 首次接触为球时，目标球的信息。 */
  target: {
    id: number;
    center: Vec2;
    /** 目标球将沿其离开的单位方向。 */
    dir: Vec2;
    /** 0..1——击打饱满度（切角余弦）。 */
    fullness: number;
  } | null;
  /** 母球在球接触后的单位方向（切线方向）。 */
  cueDeflection: Vec2 | null;
}

export function computeAimGuide(
  balls: readonly BallState[],
  angle: number,
  followDraw: number = 0,
): AimGuide | null {
  const cueBall = balls.find((ball) => ball.id === 0 && !ball.potted);
  if (!cueBall) return null;
  const cue = { x: cueBall.x, y: cueBall.y };
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };

  // 沿扫描通道最近的球。
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

  // 库边交点（台面区域按球半径内缩）。
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
  const targetDir = {
    x: targetDirRaw.x / targetLen,
    y: targetDirRaw.y / targetLen,
  };
  const fullness = Math.max(0, dir.x * targetDir.x + dir.y * targetDir.y);

  // 母球偏转与真实碰撞模型一致：
  //   v_cue' ∝ sinθ·t̂ + ((1-e)/2·fullness + followDraw·FOLLOW_DRAW_FACTOR)·n̂
  // 其中 t̂ = 归一化切线，n̂ = targetDir（背离接触点）。
  const sinTheta = Math.sqrt(Math.max(0, 1 - fullness * fullness));
  const tangentX = dir.x - fullness * targetDir.x;
  const tangentY = dir.y - fullness * targetDir.y;
  const tangentLen = Math.hypot(tangentX, tangentY);
  const tHatX = tangentLen > 1e-6 ? tangentX / tangentLen : 0;
  const tHatY = tangentLen > 1e-6 ? tangentY / tangentLen : 0;
  const restitutionTerm = ((1 - BALL_RESTITUTION) / 2) * fullness;
  const spinTerm = followDraw * FOLLOW_DRAW_FACTOR;
  const nx = sinTheta * tHatX + (restitutionTerm + spinTerm) * targetDir.x;
  const ny = sinTheta * tHatY + (restitutionTerm + spinTerm) * targetDir.y;
  const nLen = Math.hypot(nx, ny);
  const cueDeflection = nLen > 1e-6 ? { x: nx / nLen, y: ny / nLen } : null;

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
