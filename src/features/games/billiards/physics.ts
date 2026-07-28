/**
 * Deterministic shot simulation on rapier2d.
 *
 * A fresh world is built from the ball positions for every shot and torn
 * down afterwards: state-in → state-out with no hidden world reuse. That
 * (plus the fixed timestep and identical construction order) is what
 * makes outcomes reproducible for AI evaluation and, later, online
 * lockstep. Rapier's WASM floats behave identically across platforms.
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

/** Must resolve before any simulation runs (loads the WASM module). */
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
  /** First object ball the cue ball touched, or null. */
  firstContact: number | null;
  cuePotted: boolean;
  pottedInOrder: number[];
}

interface CushionSegment {
  /** Convex hull points, CCW: inner face then outer face with 45° jaws. */
  points: number[];
}

export type { CushionSegment };

/**
 * Six cushion segments (two per long rail split by the side pocket, one
 * per short rail). Ends are cut at 45° so balls deflect off pocket jaws
 * instead of hitting flat walls. Exported so the renderer draws the
 * exact shapes the physics collides with.
 */
export function cushionSegments(): CushionSegment[] {
  const t = CUSHION_THICKNESS;
  const hw = TABLE_W / 2;
  const hh = TABLE_H / 2;
  const segments: CushionSegment[] = [];

  // Long rails (top y=+hh, bottom y=-hh), each split at the side pocket.
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
  // Short rails (left x=-hw, right x=+hw).
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
 * Rounded jaw points: two per pocket mouth, sitting at the inner tips of
 * the cushions that frame the opening. A ball entering too fast or at a
 * bad angle clips one and rattles back onto the table instead of falling.
 * Order is fixed (corners in POCKET-diagonal order, then the two sides)
 * to keep the collider construction deterministic for lockstep.
 */
export function jawPoints(): Array<[number, number]> {
  const hw = TABLE_W / 2;
  const hh = TABLE_H / 2;
  const points: Array<[number, number]> = [];
  // Corner mouths: one tip on the long rail, one on the short rail.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      points.push([sx * (hw - CORNER_MOUTH), sy * hh]);
      points.push([sx * hw, sy * (hh - CORNER_MOUTH)]);
    }
  }
  // Side mouths on the long rails: symmetric tips either side of centre.
  for (const sy of [-1, 1]) {
    points.push([SIDE_MOUTH, sy * hh]);
    points.push([-SIDE_MOUTH, sy * hh]);
  }
  return points;
}

const BALL_DENSITY = BALL_MASS / (Math.PI * BALL_RADIUS * BALL_RADIUS);

/**
 * Simulate one shot to rest. Synchronous; callers must have awaited
 * `ensurePhysicsReady()` once beforehand.
 */
export function simulateShot(
  ballsIn: readonly BallState[],
  shot: ShotParams,
): ShotSimResult {
  const world = new RAPIER.World({ x: 0, y: 0 });
  world.timestep = FIXED_DT;

  try {
    // Static geometry first, in fixed order (construction order is part
    // of the determinism contract).
    for (const segment of cushionSegments()) {
      const hull = RAPIER.ColliderDesc.convexHull(
        new Float32Array(segment.points),
      );
      if (!hull) throw new Error("billiards: invalid cushion hull");
      world.createCollider(
        hull
          .setRestitution(CUSHION_RESTITUTION)
          .setFriction(CUSHION_FRICTION),
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

    // Rounded jaw points guard each mouth: a solid collider (not a
    // sensor) at each cushion tip so misaligned/fast balls rattle out.
    for (const [jx, jy] of jawPoints()) {
      world.createCollider(
        RAPIER.ColliderDesc.ball(JAW_RADIUS)
          .setTranslation(jx, jy)
          .setRestitution(JAW_RESTITUTION)
          .setFriction(CUSHION_FRICTION),
      );
    }

    // Outer containment frame so nothing can leave the world.
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

    // Balls in id order.
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
        // Remaining case: ball vs cushion/frame.
        events.push({ type: "cushion", t, ball, impact: relSpeed(ball, undefined) });
      });

      // 高低杆: at first cue-object contact, add follow/draw spin along
      // the line of centres (the impact normal), not the aim line. After
      // impact the cue naturally departs along the tangent line; pushing
      // ±normal is real top/bottom spin — follow drives it forward through
      // the object ball's line, draw pulls it back — and stays visible on
      // thin cuts where an aim-line nudge would be lost.
      if (followDrawArmed && cueContactThisStep && cueBody.isValid()) {
        const preSpeed = Math.hypot(cuePreVel.x, cuePreVel.y);
        const objBody =
          firstContact !== null ? bodyByBall.get(firstContact) : undefined;
        if (preSpeed > 1e-3) {
          // Impact normal = unit vector from cue to the struck ball. Fall
          // back to the pre-impact travel direction if the object body is
          // somehow gone (e.g. potted on the same step).
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
          const mag = shot.followDraw * FOLLOW_DRAW_FACTOR * preSpeed * BALL_MASS;
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

/** True if a ball centered at (x, y) would overlap another unpotted ball. */
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

/** True if (x, y) is a legal resting spot on the playing surface. */
export function insidePlayArea(x: number, y: number): boolean {
  return (
    Math.abs(x) <= TABLE_W / 2 - BALL_RADIUS &&
    Math.abs(y) <= TABLE_H / 2 - BALL_RADIUS
  );
}
