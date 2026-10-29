import { beforeAll, describe, expect, it } from "vitest";

import { BALL_RADIUS, FIXED_DT, POCKETS, TABLE_H } from "./constants";
import { EQUIPMENT } from "./equipment";
import { ensurePhysicsReady, simulateShot } from "./physics";
import {
  getPocketGeometries,
  pocketAt,
  pocketLocal,
  pocketWorld,
} from "./pocket-geometry";
import { computeAimGuide } from "./render/guides";
import { createInitialBalls } from "./rules";
import type { BallState, SimFrame } from "./types";

beforeAll(async () => {
  await ensurePhysicsReady();
});

function ball(id: number, x: number, y: number): BallState {
  return { id, x, y, potted: false };
}

function position(frame: SimFrame, id: number) {
  for (let i = 0; i < frame.balls.length; i += 3) {
    if (frame.balls[i] === id)
      return { x: frame.balls[i + 1], y: frame.balls[i + 2] };
  }
  return null;
}

function angleError(a: { x: number; y: number }, b: { x: number; y: number }) {
  return (
    (Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y)) * 180) /
    Math.PI
  );
}

describe("真实物理与指示线一致", () => {
  for (const cut of [0, 0.35, 0.65, 0.9, 0.98]) {
    for (const power of [0.15, 0.4, 0.8, 1]) {
      it(`切球比例 ${cut}、力度 ${power} 的离开方向吻合`, () => {
        const balls = [ball(0, -0.45, BALL_RADIUS * 2 * cut), ball(1, 0, 0)];
        const guide = computeAimGuide(balls, 0, 0, power);
        const sim = simulateShot(balls, { angle: 0, power, followDraw: 0 });
        expect(sim.firstContact).toBe(1);
        expect(guide?.target?.id).toBe(1);
        const contact = sim.firstImpact!;
        const frames = sim.frames
          .filter((f) => f.t > contact.t + FIXED_DT * 2)
          .slice(0, 2);
        const a = position(frames[0], 1)!;
        const b = position(frames[1], 1)!;
        expect(
          angleError(guide!.target!.dir, { x: b.x - a.x, y: b.y - a.y }),
        ).toBeLessThan(cut > 0.9 ? 2 : 1);
      });
    }
  }
});

it("首次接触不把预测接近误判为真正撞球", () => {
  const sim = simulateShot(
    [ball(0, -0.2, 0), ball(1, 0, BALL_RADIUS * 2 + 0.0005)],
    { angle: 0, power: 0.1, followDraw: 0 },
    true,
  );
  expect(sim.firstContact).toBeNull();
});

it("自由球附近的低力度预览不会穿过未能抵达的目标", () => {
  const guide = computeAimGuide(
    [ball(0, -0.8, 0), ball(1, 0.8, 0)],
    0,
    0,
    0.06,
  )!;
  expect(guide.target).toBeNull();
  expect(guide.contact.x).toBeLessThan(0.8 - BALL_RADIUS * 2);
});

it("瞄准参考线的最低预览力度可以抵达各球桌远端目标球", () => {
  for (const equipment of Object.values(EQUIPMENT)) {
    const x = equipment.tableWidth / 2 - equipment.ballRadius * 3;
    const y = equipment.tableHeight / 2 - equipment.ballRadius * 3;
    for (const targetY of [0, y]) {
      for (const followDraw of [-0.7, 0, 0.7]) {
        const balls = [ball(0, -x, -targetY), ball(1, x, targetY)];
        const angle = Math.atan2(targetY, x);
        const guide = computeAimGuide(balls, angle, followDraw, 0.5, equipment);
        expect(guide?.target?.id).toBe(1);
        expect(
          Math.hypot(guide!.contact.x - x, guide!.contact.y - targetY),
        ).toBeCloseTo(equipment.ballRadius * 2, 2);
        expect(guide!.target!.length).toBeGreaterThan(0);
      }
    }
  }
});

it("中袋落袋记录保留入射速度，台面内擦袋口不会被吸入", () => {
  const toward = simulateShot([ball(0, 0, 0)], {
    angle: Math.PI / 2,
    power: 0.3,
    followDraw: 0,
  });
  const event = toward.events.find((e) => e.type === "pocket");
  expect(event?.type).toBe("pocket");
  if (event?.type === "pocket") {
    expect(pocketAt(event)?.id).toBe(event.pocket);
    expect(event.vy).toBeGreaterThan(0);
    expect(Math.abs(event.vx)).toBeLessThan(1e-5);
  }
  const across = simulateShot(
    [ball(0, -0.3, TABLE_H / 2 - BALL_RADIUS - 0.002)],
    { angle: 0, power: 0.2, followDraw: 0 },
    true,
  );
  expect(across.cuePotted).toBe(false);
});

it("推杆与拉杆随行进衰减并反映在母球出射线", () => {
  const balls = [ball(0, -0.22, 0), ball(1, 0, 0)];
  const draw = computeAimGuide(balls, 0, -0.7, 0.4)!;
  const follow = computeAimGuide(balls, 0, 0.7, 0.4)!;
  expect(draw.cueDeflection!.x).toBeLessThan(0);
  expect(follow.cueDeflection!.x).toBeGreaterThan(0);
});

it("相同开球结果确定且时间线从零开始，无非有限坐标", () => {
  const balls = createInitialBalls();
  const shot = { angle: 0, power: 1, followDraw: 0 };
  const first = simulateShot(balls, shot);
  const second = simulateShot(balls, shot);
  expect(first).toEqual(second);
  expect(first.frames[0].t).toBe(0);
  expect(
    first.balls.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y)),
  ).toBe(true);
  // 摆球随种子随机，正向开球的首碰应是顶点球（x 最小的目标球）。
  const apex = balls
    .filter((b) => b.id !== 0)
    .reduce((a, b) => (a.x < b.x ? a : b));
  expect(first.firstContact).toBe(apex.id);
});

it("高速极薄切在不同采样相位下均先撞目标球", () => {
  for (let i = 0; i < 16; i++) {
    const sim = simulateShot(
      [ball(0, -0.4 - i * 0.001, BALL_RADIUS * 1.96), ball(1, 0, 0)],
      { angle: 0, power: 1, followDraw: 0 },
      true,
    );
    expect(sim.firstImpact?.targetId).toBe(1);
  }
});

it("近贴球与同时接触的首碰不依赖输入数组顺序", () => {
  for (const balls of [
    [ball(0, -BALL_RADIUS * 2 - 0.0002, 0), ball(1, 0, 0)],
    [
      ball(0, -0.3, 0),
      ball(1, 0, BALL_RADIUS * 1.1),
      ball(2, 0, -BALL_RADIUS * 1.1),
    ],
  ]) {
    const shot = { angle: 0, power: 0.4, followDraw: 0 };
    const a = simulateShot(balls, shot);
    const b = simulateShot([...balls].reverse(), shot);
    expect(a.firstContact).toBe(1);
    expect(a.events).toEqual(b.events);
  }
});

it("六个袋口的正向入射均能落袋并保留向外速度", () => {
  for (const pocket of POCKETS) {
    const sim = simulateShot(
      [
        ball(
          0,
          pocket.x - Math.sign(pocket.x) * 0.25,
          pocket.y - Math.sign(pocket.y) * 0.25,
        ),
      ],
      {
        angle: Math.atan2(Math.sign(pocket.y), Math.sign(pocket.x)),
        power: 0.3,
        followDraw: 0,
      },
    );
    const event = sim.events.find((e) => e.type === "pocket");
    expect(event?.type).toBe("pocket");
    if (event?.type === "pocket") {
      expect(event.pocket).toBe(pocket.id);
      expect(event.vx * pocket.x + event.vy * pocket.y).toBeGreaterThan(0);
    }
  }
});

describe("六袋实际通道的落袋回归", () => {
  it("擦向入口袋颚的入射先碰库，不穿过袋颚直接落袋", () => {
    for (const equipment of Object.values(EQUIPMENT)) {
      for (const pocket of getPocketGeometries(equipment)) {
        const entrance = pocketLocal(pocket.spec, pocket.right[0]);
        for (const side of [-1, 1]) {
          const start = pocketWorld(
            pocket.spec,
            side * (entrance.x - equipment.ballRadius + 0.006),
            entrance.y - 0.2,
          );
          const sim = simulateShot(
            [ball(0, start.x, start.y)],
            {
              angle: Math.atan2(pocket.spec.dy, pocket.spec.dx),
              power: 0.5,
              followDraw: 0,
            },
            true,
            equipment,
          );
          expect(sim.firstImpact).not.toBeNull();
          expect(sim.firstImpact?.targetId).toBeNull();
          expect(sim.cuePotted).toBe(false);
          expect(sim.events.some((event) => event.type === "cushion")).toBe(
            true,
          );
        }
      }
    }
  });

  for (const pocket of POCKETS) {
    it(`第 ${pocket.id + 1} 个袋口沿真实喉部进球，低中高力度均可落袋`, () => {
      const x = Math.sign(pocket.x);
      const y = Math.sign(pocket.y);
      const distance = Math.hypot(x, y);
      const dir = { x: x / distance, y: y / distance };
      for (const power of [0.15, 0.5, 0.9]) {
        const sim = simulateShot(
          [ball(0, pocket.x - dir.x * 0.3, pocket.y - dir.y * 0.3)],
          { angle: Math.atan2(dir.y, dir.x), power, followDraw: 0 },
        );
        expect(sim.cuePotted).toBe(true);
        expect(sim.events.find((e) => e.type === "pocket")).toMatchObject({
          pocket: pocket.id,
        });
      }
    });
  }
});
