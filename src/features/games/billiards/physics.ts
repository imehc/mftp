/** 固定步长的确定性模拟；预览和正式出杆使用同一求解器。 */
import RAPIER from "@dimforge/rapier2d-compat";

import {
  ANGULAR_DAMPING,
  BALL_FRICTION,
  BALL_RESTITUTION,
  CUSHION_FRICTION,
  CUSHION_RESTITUTION,
  FIXED_DT,
  FOLLOW_DRAW_FACTOR,
  FRAME_DT,
  LINEAR_DAMPING,
  MAX_SHOT_SPEED,
  MAX_SIM_SECONDS,
  ROLLING_DECELERATION,
  STOP_SPEED,
} from "./constants";
import { CHINESE_EIGHT, type TableEquipment } from "./equipment";
import { cushionSegments } from "./geometry";
import { pocketAt } from "./pocket-geometry";
import { createShotFacts, distanceToEdge, type ShotFacts } from "./shot-facts";
import type { BallState, SimEvent, SimFrame } from "./types";

export { cushionSegments } from "./geometry";

let initPromise: Promise<unknown> | null = null;

export function ensurePhysicsReady(): Promise<unknown> {
  initPromise ??= RAPIER.init().catch((error: unknown) => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

export interface ShotParams {
  angle: number;
  power: number;
  followDraw: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface FirstImpact {
  t: number;
  cue: Vec2;
  targetId: number | null;
  target: Vec2 | null;
  cueVelocity: Vec2;
  targetVelocity: Vec2 | null;
}

export interface ShotSimResult {
  balls: BallState[];
  frames: SimFrame[];
  events: SimEvent[];
  facts: ShotFacts;
  firstContact: number | null;
  firstImpact: FirstImpact | null;
  cuePotted: boolean;
  pottedInOrder: number[];
}

interface Contact {
  a: number;
  b: number | undefined;
  impact: number;
  order: number;
  rail?: number;
}

/** 用碰前扫掠时间排列同一物理步的接触，避免依赖 WASM 回调顺序。 */
function contactTime(
  a: Vec2,
  b: Vec2,
  va: Vec2,
  vb: Vec2,
  radius: number,
): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const vx = va.x - vb.x;
  const vy = va.y - vb.y;
  const dot = x * vx + y * vy;
  const vv = vx * vx + vy * vy;
  const gap = x * x + y * y - (radius * 2) ** 2;
  const discriminant = dot * dot - vv * gap;
  if (gap <= 0 || vv < 1e-12 || discriminant < 0) return 0;
  return Math.max(0, (-dot - Math.sqrt(discriminant)) / vv);
}

function buildWorld(
  equipment: TableEquipment,
  rails: Map<number, number>,
): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: 0 });
  world.timestep = FIXED_DT;
  // 默认的毫米级容差对 57mm 球的薄切过大，必须按球的尺寸缩小。
  world.integrationParameters.normalizedAllowedLinearError = 0.00001;
  world.integrationParameters.normalizedPredictionDistance = 0.00005;
  world.numSolverIterations = 8;
  for (const [index, segment] of cushionSegments(equipment).entries()) {
    const hull = RAPIER.ColliderDesc.convexHull(
      new Float32Array(segment.points),
    );
    if (!hull) {
      world.free();
      throw new Error("billiards: invalid cushion hull");
    }
    const collider = world.createCollider(
      hull
        .setRestitution(CUSHION_RESTITUTION)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setFriction(CUSHION_FRICTION),
    );
    rails.set(collider.handle, index);
  }
  const fw =
    equipment.tableWidth / 2 +
    equipment.cushionWidth +
    equipment.frameWidth +
    0.01;
  const fh =
    equipment.tableHeight / 2 +
    equipment.cushionWidth +
    equipment.frameWidth +
    0.01;
  for (const [x, y, hx, hy] of [
    [0, fh, fw + 0.1, 0.05],
    [0, -fh, fw + 0.1, 0.05],
    [fw, 0, 0.05, fh + 0.1],
    [-fw, 0, 0.05, fh + 0.1],
  ])
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy).setTranslation(x, y),
    );
  return world;
}

/** preview 在母球第一次实际接触时停止，避免完整模拟整杆来更新指示线。 */
export function simulateShot(
  ballsIn: readonly BallState[],
  shot: ShotParams,
  preview = false,
  equipment: TableEquipment = CHINESE_EIGHT,
): ShotSimResult {
  const BALL_RADIUS = equipment.ballRadius;
  const BALL_MASS = equipment.ballMass;
  if (![shot.angle, shot.power, shot.followDraw].every(Number.isFinite)) {
    throw new Error("billiards: invalid shot parameters");
  }
  const rails = new Map<number, number>();
  const cushions = cushionSegments(equipment);
  const world = buildWorld(equipment, rails);
  const recorder = createShotFacts(ballsIn, equipment);
  const queue = new RAPIER.EventQueue(true);
  try {
    const bodies = new Map<number, RAPIER.RigidBody>();
    const ids = new Map<number, number>();
    const active = ballsIn.filter((b) => !b.potted).sort((a, b) => a.id - b.id);
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
          .setDensity(BALL_MASS / (Math.PI * BALL_RADIUS ** 2))
          .setActiveEvents(
            RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS |
              RAPIER.ActiveEvents.COLLISION_EVENTS,
          )
          .setContactForceEventThreshold(0),
        body,
      );
      bodies.set(ball.id, body);
      ids.set(collider.handle, ball.id);
    }
    const cue = bodies.get(0);
    if (!cue) throw new Error("billiards: cue ball missing");
    const speed = Math.max(0.02, Math.min(1, shot.power)) * MAX_SHOT_SPEED;
    cue.setLinvel(
      { x: Math.cos(shot.angle) * speed, y: Math.sin(shot.angle) * speed },
      true,
    );
    const events: SimEvent[] = [];
    const frames: SimFrame[] = [];
    const potted = new Set<number>();
    const pottedInOrder: number[] = [];
    let firstContact: number | null = null;
    let firstImpact: FirstImpact | null = null;
    const lastContact = new Map<string, number>();
    const positions = new Map<number, Vec2>();
    const velocities = new Map<number, Vec2>();

    const sample = (t: number) => {
      const balls: number[] = [];
      for (const [id, body] of bodies) {
        const p = body.translation();
        balls.push(id, p.x, p.y);
      }
      frames.push({ t, balls });
    };

    sample(0);
    for (let step = 0; step < Math.ceil(MAX_SIM_SECONDS / FIXED_DT); step++) {
      const t = (step + 1) * FIXED_DT;
      positions.clear();
      velocities.clear();
      for (const [id, body] of bodies) {
        positions.set(id, body.translation());
        velocities.set(id, body.linvel());
      }
      world.step(queue);
      const contacts: Contact[] = [];
      queue.drainCollisionEvents((a, b, started) => {
        if (started) return;
        const ball = ids.get(a) ?? ids.get(b);
        const rail = rails.get(a) ?? rails.get(b);
        if (ball !== undefined && rail !== undefined)
          recorder.releaseRail(ball, rail);
      });
      queue.drainContactForceEvents((event) => {
        const a = ids.get(event.collider1()) ?? ids.get(event.collider2());
        if (a === undefined) return;
        const other =
          ids.get(event.collider1()) === a
            ? event.collider2()
            : event.collider1();
        const b = ids.get(other);
        const va = velocities.get(a)!;
        const vb = b === undefined ? { x: 0, y: 0 } : velocities.get(b)!;
        const normal = event.maxForceDirection();
        const impact = Math.abs(
          (va.x - vb.x) * normal.x + (va.y - vb.y) * normal.y,
        );
        const rail = rails.get(other);
        const before = positions.get(a)!;
        const railTime =
          rail === undefined || impact < 1e-12
            ? 0
            : Math.max(
                0,
                (distanceToEdge(before.x, before.y, cushions[rail].points) -
                  BALL_RADIUS) /
                  impact,
              );
        contacts.push({
          a,
          b,
          impact,
          rail,
          order:
            b === undefined
              ? railTime
              : contactTime(
                  positions.get(a)!,
                  positions.get(b)!,
                  va,
                  vb,
                  BALL_RADIUS,
                ),
        });
      });
      contacts.sort(
        (a, b) =>
          a.order - b.order ||
          Math.min(a.a, a.b ?? a.a) - Math.min(b.a, b.b ?? b.a) ||
          (a.b ?? -1) - (b.b ?? -1),
      );
      let cueHit: Contact | undefined;
      for (const contact of contacts) {
        const { a, b, impact, rail } = contact;
        const contactT = t - FIXED_DT + Math.min(FIXED_DT, contact.order);
        if (b !== undefined) recorder.ballContact(a, b, contactT);
        else if (rail !== undefined) recorder.railContact(a, rail, contactT);
        const key =
          b === undefined ? `${a}:rail` : `${Math.min(a, b)}:${Math.max(a, b)}`;
        if (t - (lastContact.get(key) ?? -1) > 0.04 && impact > 0.015) {
          events.push(
            b === undefined
              ? { type: "cushion", t, ball: a, impact }
              : { type: "ball-ball", t, a, b, impact },
          );
        }
        lastContact.set(key, t);
        if (a !== 0 && b !== 0) continue;
        cueHit ??= contact;
        if (firstContact !== null || b === undefined) continue;
        firstContact = a === 0 ? b : a;
        // 简化的跟/缩杆以碰前速度和接触饱满度决定，并随行进时间衰减。
        const target = bodies.get(firstContact)!;
        const cp = cue.translation();
        const tp = target.translation();
        const distance = Math.hypot(tp.x - cp.x, tp.y - cp.y);
        const nx = (tp.x - cp.x) / distance;
        const ny = (tp.y - cp.y) / distance;
        const before = velocities.get(0)!;
        const normalSpeed = Math.max(0, before.x * nx + before.y * ny);
        const spin =
          Math.max(-1, Math.min(1, shot.followDraw)) *
          FOLLOW_DRAW_FACTOR *
          Math.exp(-t * 1.1);
        cue.applyImpulse(
          {
            x: nx * normalSpeed * spin * BALL_MASS,
            y: ny * normalSpeed * spin * BALL_MASS,
          },
          true,
        );
      }
      if (!firstImpact && cueHit) {
        const id =
          cueHit.b === undefined ? null : cueHit.a === 0 ? cueHit.b : cueHit.a;
        const target = id === null ? null : bodies.get(id);
        firstImpact = {
          t,
          cue: cue.translation(),
          targetId: id,
          target: target?.translation() ?? null,
          cueVelocity: cue.linvel(),
          targetVelocity: target?.linvel() ?? null,
        };
      }
      for (const [id, body] of bodies) {
        const pos = body.translation();
        const vel = body.linvel();
        // 球心跨过可见开孔即失去支撑，不再等待独立的固定袋深。
        recorder.position(id, positions.get(id)!.x, pos.x);
        const pocket = pocketAt(pos, equipment);
        if (pocket) {
          // 保存消失前的精确位置，让呈现能插值到入袋时刻，而不是先停住再跳入袋口。
          if (!preview && frames[frames.length - 1]?.t !== t) sample(t);
          events.push({
            type: "pocket",
            t,
            ball: id,
            pocket: pocket.id,
            x: pos.x,
            y: pos.y,
            vx: vel.x,
            vy: vel.y,
          });
          potted.add(id);
          if (id !== 0) pottedInOrder.push(id);
          world.removeRigidBody(body);
          bodies.delete(id);
          continue;
        }
        const v = Math.hypot(vel.x, vel.y);
        const next = Math.max(0, v - ROLLING_DECELERATION * FIXED_DT);
        if (v > 0)
          body.setLinvel(
            next < STOP_SPEED
              ? { x: 0, y: 0 }
              : { x: (vel.x * next) / v, y: (vel.y * next) / v },
            true,
          );
      }
      const stopped = [...bodies.values()].every(
        (b) => Math.hypot(b.linvel().x, b.linvel().y) < STOP_SPEED,
      );
      const done =
        stopped || (preview && (firstImpact !== null || potted.has(0)));
      if ((step + 1) % Math.round(FRAME_DT / FIXED_DT) === 0 || done) sample(t);
      if (done) break;
    }
    return {
      balls: ballsIn.map((ball) => {
        const pos = bodies.get(ball.id)?.translation();
        return {
          ...ball,
          ...(pos ? { x: pos.x, y: pos.y } : {}),
          potted: ball.potted || potted.has(ball.id),
        };
      }),
      frames,
      events,
      facts: recorder.facts,
      firstContact,
      firstImpact,
      cuePotted: potted.has(0),
      pottedInOrder,
    };
  } finally {
    queue.free();
    world.free();
  }
}

export function overlapsAnyBall(
  balls: readonly BallState[],
  x: number,
  y: number,
  ignoreId?: number,
  equipment: TableEquipment = CHINESE_EIGHT,
): boolean {
  return balls.some(
    (b) =>
      !b.potted &&
      b.id !== ignoreId &&
      Math.hypot(b.x - x, b.y - y) < equipment.ballRadius * 2 + 0.0001,
  );
}

export function insidePlayArea(
  x: number,
  y: number,
  equipment: TableEquipment = CHINESE_EIGHT,
): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) <= equipment.tableWidth / 2 - equipment.ballRadius &&
    Math.abs(y) <= equipment.tableHeight / 2 - equipment.ballRadius
  );
}
