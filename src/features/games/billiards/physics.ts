/**
 * 基于 rapier2d 的确定性击球模拟。
 *
 * 每次击球都从球的当前位置新建一个世界，结束后销毁：状态进 → 状态出，
 * 不复用隐藏的世界。这一点（加上固定步长和一致的构建顺序）正是
 * AI 评估，以及将来联机锁步时结果可复现的原因。Rapier 的 WASM 浮点
 * 在各平台上表现一致。
 */
import RAPIER from "@dimforge/rapier2d-compat";
import {
  ANGULAR_DAMPING,
  BALL_FRICTION,
  BALL_MASS,
  BALL_RADIUS,
  BALL_RESTITUTION,
  CORNER_MOUTH,
  CUSHION_FRICTION,
  CUSHION_RESTITUTION,
  CUSHION_THICKNESS,
  FIXED_DT,
  FOLLOW_DRAW_FACTOR,
  JAW_RADIUS,
  JAW_RESTITUTION,
  LINEAR_DAMPING,
  MAX_SHOT_SPEED,
  MAX_SIM_SECONDS,
  POCKET_CAPTURE_SCALE,
  POCKETS,
  SIDE_MOUTH,
  STOP_SPEED,
  TABLE_H,
  TABLE_W,
} from "./constants";
import type { BallState, SimEvent, SimFrame } from "./types";

let initPromise: Promise<unknown> | null = null;

/** 任何模拟运行前必须先 resolve（用于加载 WASM 模块）。 */
export function ensurePhysicsReady(): Promise<unknown> {
  initPromise ??= RAPIER.init();
  return initPromise;
}

export interface ShotParams {
  angle: number;
  power: number;
  followDraw: number;
}

export interface ShotSimResult {
  balls: BallState[];
  frames: SimFrame[];
  events: SimEvent[];
  /** 母球碰到的第一颗目标球，没有则为 null。 */
  firstContact: number | null;
  cuePotted: boolean;
  pottedInOrder: number[];
}

interface CushionSegment {
  /** 凸包顶点，逆时针：先内沿，后外沿，含 45° 袋口颚。 */
  points: number[];
}

export type { CushionSegment };

/**
 * 六段库边（每条长边被中袋分成两段，每条短边一段）。两端切 45°，
 * 使球从袋口颚弹开而非撞上平直的墙。导出给渲染器，以绘制与物理
 * 碰撞完全一致的形状。
 */
export function cushionSegments(): CushionSegment[] {
  const t = CUSHION_THICKNESS;
  const hw = TABLE_W / 2;
  const hh = TABLE_H / 2;
  const segments: CushionSegment[] = [];

  // 长边（上 y=+hh，下 y=-hh），各在中袋处断开。
  for (const sy of [-1, 1]) {
    for (const [x0, x1] of [
      [-hw + CORNER_MOUTH, -SIDE_MOUTH],
      [SIDE_MOUTH, hw - CORNER_MOUTH],
    ]) {
      const yIn = sy * hh;
      const yOut = sy * (hh + t);
      segments.push({
        points: [x0, yIn, x1, yIn, x1 + t, yOut, x0 - t, yOut],
      });
    }
  }
  // 短边（左 x=-hw，右 x=+hw）。
  for (const sx of [-1, 1]) {
    const xIn = sx * hw;
    const xOut = sx * (hw + t);
    const y0 = -hh + CORNER_MOUTH;
    const y1 = hh - CORNER_MOUTH;
    segments.push({
      points: [xIn, y0, xIn, y1, xOut, y1 + t, xOut, y0 - t],
    });
  }
  return segments;
}

/**
 * 圆角袋口颚点：每个袋口两个，位于围成开口的库边内尖端。球进得太快
 * 或角度太差时会蹭到其中一点弹回台面而非落袋。顺序固定（角袋按
 * POCKET 对角线顺序，再是中袋两个），以保证碰撞体构建在锁步下确定。
 */
export function jawPoints(): Array<[number, number]> {
  const hw = TABLE_W / 2;
  const hh = TABLE_H / 2;
  const points: Array<[number, number]> = [];
  // 角袋口：一个尖端在长边，一个在短边。
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      points.push([sx * (hw - CORNER_MOUTH), sy * hh]);
      points.push([sx * hw, sy * (hh - CORNER_MOUTH)]);
    }
  }
  // 长边上的中袋口：中心两侧对称的尖端。
  for (const sy of [-1, 1]) {
    points.push([SIDE_MOUTH, sy * hh]);
    points.push([-SIDE_MOUTH, sy * hh]);
  }
  return points;
}

const BALL_DENSITY = BALL_MASS / (Math.PI * BALL_RADIUS * BALL_RADIUS);

/**
 * 模拟一杆直到静止。同步执行；调用方必须事先 await 过一次
 * `ensurePhysicsReady()`。
 */
export function simulateShot(
  ballsIn: readonly BallState[],
  shot: ShotParams,
): ShotSimResult {
  const world = new RAPIER.World({ x: 0, y: 0 });
  world.timestep = FIXED_DT;

  try {
    // 先按固定顺序构建静态几何（构建顺序属于确定性约定的一部分）。
    for (const segment of cushionSegments()) {
      const hull = RAPIER.ColliderDesc.convexHull(
        new Float32Array(segment.points),
      );
      if (!hull) throw new Error("billiards: invalid cushion hull");
      world.createCollider(
        hull.setRestitution(CUSHION_RESTITUTION).setFriction(CUSHION_FRICTION),
      );
    }

    const pocketHandles = new Map<number, number>();
    for (const pocket of POCKETS) {
      const collider = world.createCollider(
        RAPIER.ColliderDesc.ball(pocket.radius * POCKET_CAPTURE_SCALE)
          .setTranslation(pocket.x, pocket.y)
          .setSensor(true)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      );
      pocketHandles.set(collider.handle, pocket.id);
    }

    // 圆角颚点把守每个袋口：每个库边尖端放一个实心碰撞体（非传感器），
    // 让对位不准或过快的球弹出去。
    for (const [jx, jy] of jawPoints()) {
      world.createCollider(
        RAPIER.ColliderDesc.ball(JAW_RADIUS)
          .setTranslation(jx, jy)
          .setRestitution(JAW_RESTITUTION)
          .setFriction(CUSHION_FRICTION),
      );
    }

    // 外层围框，确保任何物体都不会离开世界。
    const frame = 0.16;
    const fw = TABLE_W / 2 + frame;
    const fh = TABLE_H / 2 + frame;
    for (const [x, y, hx, hy] of [
      [0, fh, fw + 0.1, 0.05],
      [0, -fh, fw + 0.1, 0.05],
      [fw, 0, 0.05, fh + 0.1],
      [-fw, 0, 0.05, fh + 0.1],
    ]) {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy).setTranslation(x, y),
      );
    }

    // 按 id 顺序放入球。
    const active = ballsIn.filter((ball) => !ball.potted);
    const bodyByBall = new Map<number, RAPIER.RigidBody>();
    const ballByCollider = new Map<number, number>();
    for (const ball of active) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(ball.x, ball.y)
          .setLinearDamping(LINEAR_DAMPING)
          .setAngularDamping(ANGULAR_DAMPING)
          .setCcdEnabled(true),
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.ball(BALL_RADIUS)
          .setRestitution(BALL_RESTITUTION)
          .setFriction(BALL_FRICTION)
          .setDensity(BALL_DENSITY)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      bodyByBall.set(ball.id, body);
      ballByCollider.set(collider.handle, ball.id);
    }

    const cueBody = bodyByBall.get(0);
    if (!cueBody) throw new Error("billiards: cue ball missing");
    const speed = Math.max(0.02, Math.min(1, shot.power)) * MAX_SHOT_SPEED;
    cueBody.setLinvel(
      { x: Math.cos(shot.angle) * speed, y: Math.sin(shot.angle) * speed },
      true,
    );

    const events: SimEvent[] = [];
    const frames: SimFrame[] = [];
    const pottedInOrder: number[] = [];
    const potted = new Set<number>();
    let firstContact: number | null = null;
    let followDrawArmed = Math.abs(shot.followDraw) > 0.01;
    let cuePreVel = { x: 0, y: 0 };

    const eventQueue = new RAPIER.EventQueue(true);
    const maxSteps = Math.ceil(MAX_SIM_SECONDS / FIXED_DT);

    const relSpeed = (a: number | undefined, b: number | undefined): number => {
      const va = a !== undefined ? bodyByBall.get(a)?.linvel() : undefined;
      const vb = b !== undefined ? bodyByBall.get(b)?.linvel() : undefined;
      const ax = va?.x ?? 0;
      const ay = va?.y ?? 0;
      const bx = vb?.x ?? 0;
      const by = vb?.y ?? 0;
      return Math.hypot(ax - bx, ay - by);
    };

    for (let step = 0; step < maxSteps; step++) {
      const t = (step + 1) * FIXED_DT;
      const cueVelBefore = cueBody.isValid() ? cueBody.linvel() : null;
      if (cueVelBefore) cuePreVel = { x: cueVelBefore.x, y: cueVelBefore.y };

      world.step(eventQueue);

      const toRemove: number[] = [];
      let cueContactThisStep = false;

      eventQueue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const ballA = ballByCollider.get(h1);
        const ballB = ballByCollider.get(h2);
        const pocketA = pocketHandles.get(h1);
        const pocketB = pocketHandles.get(h2);

        if (ballA !== undefined && ballB !== undefined) {
          const impact = relSpeed(ballA, ballB);
          events.push({ type: "ball-ball", t, a: ballA, b: ballB, impact });
          if (firstContact === null && (ballA === 0 || ballB === 0)) {
            firstContact = ballA === 0 ? ballB : ballA;
            cueContactThisStep = true;
          }
          return;
        }

        const ball = ballA ?? ballB;
        if (ball === undefined) return;
        const pocket = pocketA ?? pocketB;
        if (pocket !== undefined) {
          if (!potted.has(ball)) {
            potted.add(ball);
            if (ball !== 0) pottedInOrder.push(ball);
            events.push({ type: "pocket", t, ball, pocket });
            toRemove.push(ball);
          }
          return;
        }
        // 剩余情况：球对库边/围框。
        events.push({
          type: "cushion",
          t,
          ball,
          impact: relSpeed(ball, undefined),
        });
      });

      // 跟杆/缩杆旋转（高杆/低杆击打）：在母球与目标球首次接触的瞬间，
      // 沿两球连心线（即碰撞法线）而非瞄准线施加跟/缩旋。撞击后母球
      // 自然沿切线离开；沿 ±法线推才是真正的上/下旋——跟杆把它向前
      // 推出穿过目标球线，缩杆把它拉回——并且在薄切球时依然可见，
      // 而沿瞄准线轻推则会丢失。
      if (followDrawArmed && cueContactThisStep && cueBody.isValid()) {
        const preSpeed = Math.hypot(cuePreVel.x, cuePreVel.y);
        const objBody =
          firstContact !== null ? bodyByBall.get(firstContact) : undefined;
        if (preSpeed > 1e-3) {
          // 碰撞法线 = 从母球指向被击球的单位向量。若目标球因某种原因
          // 已不存在（如同一模拟步内落袋），则回退到撞击前的运动方向。
          const cuePos = cueBody.translation();
          let nx = cuePreVel.x / preSpeed;
          let ny = cuePreVel.y / preSpeed;
          if (objBody) {
            const objPos = objBody.translation();
            const dx = objPos.x - cuePos.x;
            const dy = objPos.y - cuePos.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 1e-6) {
              nx = dx / dist;
              ny = dy / dist;
            }
          }
          const mag =
            shot.followDraw * FOLLOW_DRAW_FACTOR * preSpeed * BALL_MASS;
          cueBody.applyImpulse({ x: nx * mag, y: ny * mag }, true);
        }
        followDrawArmed = false;
      }

      for (const ball of toRemove) {
        const body = bodyByBall.get(ball);
        if (body) {
          world.removeRigidBody(body);
          bodyByBall.delete(ball);
        }
      }

      const frameBalls: number[] = [];
      let allStopped = true;
      for (const [id, body] of bodyByBall) {
        const pos = body.translation();
        frameBalls.push(id, pos.x, pos.y);
        const vel = body.linvel();
        if (Math.hypot(vel.x, vel.y) > STOP_SPEED) allStopped = false;
      }
      frames.push({ t, balls: frameBalls });

      if (allStopped && step * FIXED_DT > 0.1) break;
    }
    eventQueue.free();

    const balls: BallState[] = ballsIn.map((ball) => {
      if (ball.potted) return { ...ball };
      if (potted.has(ball.id)) return { ...ball, potted: true };
      const body = bodyByBall.get(ball.id);
      if (!body) return { ...ball };
      const pos = body.translation();
      return { id: ball.id, x: pos.x, y: pos.y, potted: false };
    });

    return {
      balls,
      frames,
      events,
      firstContact,
      cuePotted: potted.has(0),
      pottedInOrder,
    };
  } finally {
    world.free();
  }
}

/** 以 (x, y) 为中心的球是否会与另一颗未落袋的球重叠。 */
export function overlapsAnyBall(
  balls: readonly BallState[],
  x: number,
  y: number,
  ignoreId?: number,
): boolean {
  return balls.some(
    (ball) =>
      !ball.potted &&
      ball.id !== ignoreId &&
      Math.hypot(ball.x - x, ball.y - y) < BALL_RADIUS * 2,
  );
}

/** (x, y) 是否为台面上合法的静止落点。 */
export function insidePlayArea(x: number, y: number): boolean {
  return (
    Math.abs(x) <= TABLE_W / 2 - BALL_RADIUS &&
    Math.abs(y) <= TABLE_H / 2 - BALL_RADIUS
  );
}
