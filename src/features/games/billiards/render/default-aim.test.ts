import { beforeAll, describe, expect, it } from "vitest";

import { BALL_RADIUS, TABLE_H, TABLE_W } from "../constants";
import { SNOOKER } from "../equipment";
import {
  ensurePhysicsReady,
  insidePlayArea,
  overlapsAnyBall,
  simulateShot,
} from "../physics";
import { createInitialState } from "../rules";
import { createSnookerState } from "../snooker";
import { targetBallIds } from "../targets";
import type { BallState, EightBallState } from "../types";
import { createDefaultAim, defaultAim } from "./default-aim";

const ball = (id: number, x: number, y: number, potted = false): BallState => ({
  id,
  x,
  y,
  potted,
});

function position(balls: BallState[]): EightBallState {
  return {
    ...createInitialState("eight-ball"),
    balls,
    groups: ["solids", "stripes"],
    openTable: false,
    breakDone: true,
  };
}

beforeAll(ensurePhysicsReady);

describe("默认目标遵守当前球权和碰撞路径", () => {
  it("不沿用对手方向，优先无遮挡本方球而非最近对方球", () => {
    const state = position([ball(0, 0, 0), ball(9, 0.15, 0), ball(1, 0, 0.3)]);
    const aim = defaultAim(state)!;
    expect(aim.targetId).toBe(1);
    expect(aim.angle).toBeCloseTo(Math.PI / 2);
    expect(
      simulateShot(
        state.balls,
        { angle: aim.angle, power: 0.5, followDraw: 0 },
        true,
      ).firstContact,
    ).toBe(1);
    expect(defaultAim({ ...state, turnSeat: 1 })?.targetId).toBe(9);
  });

  it("最近的本方球被挡住时选择另一个可直击目标", () => {
    const state = position([
      ball(0, 0, 0),
      ball(1, 0.3, 0),
      ball(9, 0.15, 0.03),
      ball(2, 0, 0.4),
    ]);
    expect(defaultAim(state)?.targetId).toBe(2);
    expect(
      defaultAim({ ...state, balls: state.balls.filter((b) => b.id !== 2) }),
    ).toBeNull();
  });

  it("按完整球径检查擦边遮挡，已落袋球不再阻挡或成为目标", () => {
    const balls = [
      ball(0, -0.3, 0),
      ball(1, 0.3, 0),
      ball(9, 0, BALL_RADIUS * 2 - 0.001),
    ];
    expect(defaultAim(position(balls))).toBeNull();
    balls[2].potted = true;
    expect(defaultAim(position(balls))?.targetId).toBe(1);
    balls[1].potted = true;
    expect(defaultAim(position(balls))).toBeNull();
  });

  it("斯诺克全部红球被挡时退回最开阔的红球，中式保持不强加朝向", () => {
    // 粉球正挡在红球堆前，两颗红球分别被挡住一半和大半。
    const snooker = {
      ...createSnookerState(6),
      balls: [
        ball(0, -1.0, 0),
        ball(6, -0.5, 0),
        ball(8, 0.0, 0),
        ball(9, 0.0, 0.02),
      ],
    };
    const aim = defaultAim(snooker, SNOOKER);
    expect(aim?.targetId).toBe(9);
    const eight = position([
      ball(0, -1.0, 0),
      ball(9, -0.5, 0),
      ball(1, 0.0, 0),
    ]);
    expect(defaultAim(eight)).toBeNull();
  });

  it("未清空本组时排除黑八，清空后才瞄准黑八", () => {
    const state = position([ball(0, 0, 0), ball(8, 0.15, 0), ball(1, 0, 0.3)]);
    expect(targetBallIds(state, 0)).toEqual([1]);
    state.balls[2].potted = true;
    expect(defaultAim(state)?.targetId).toBe(8);
    expect(defaultAim({ ...state, openTable: true })).toBeNull();
    expect(defaultAim({ ...state, variant: "practice" })?.targetId).toBe(8);
  });

  it("开放桌可瞄准全色或花色，缺少母球和终局不生成默认角度", () => {
    const state = {
      ...position([ball(0, 0, 0), ball(8, 0, 0.1), ball(9, 0.2, 0)]),
      openTable: true,
    };
    expect(defaultAim(state)?.targetId).toBe(9);
    expect(defaultAim({ ...state, finished: true })).toBeNull();
    state.balls[0].potted = true;
    expect(defaultAim(state)).toBeNull();
  });

  it("同距目标按球号稳定选择，不依赖数组顺序", () => {
    const state = position([ball(0, 0, 0), ball(2, 0, 0.3), ball(1, 0.3, 0)]);
    expect(defaultAim(state)?.targetId).toBe(1);
    expect(defaultAim({ ...state, balls: [...state.balls].reverse() })).toEqual(
      defaultAim(state),
    );
  });
});

describe("每杆初始化与中式八球台面", () => {
  it("开球朝向球堆顶点，初始摆球位于台面且不重叠", () => {
    const state = createInitialState("eight-ball");
    expect(defaultAim(state)).toEqual({ angle: 0, targetId: 1 });
    for (const ball of state.balls) {
      expect(insidePlayArea(ball.x, ball.y)).toBe(true);
      expect(overlapsAnyBall(state.balls, ball.x, ball.y, ball.id)).toBe(false);
    }
    expect(TABLE_W).toBe(2.54);
    expect(TABLE_H).toBe(1.27);
    expect((2 * BALL_RADIUS) / TABLE_W).toBeCloseTo(0.0225, 5);
  });

  it("普通重渲染不抢手动瞄准，连续出杆、双人换手与重开会重新初始化", () => {
    const defaults = createDefaultAim();
    const state = position([ball(0, 0, 0), ball(1, 0, 0.3), ball(9, 0.3, 0)]);
    expect(defaults.update(state, true)).toBeCloseTo(Math.PI / 2);
    expect(defaults.update(structuredClone(state), true)).toBeNull();
    expect(defaults.update({ ...state, shotCount: 1 }, true)).toBeCloseTo(
      Math.PI / 2,
    );
    expect(defaults.update({ ...state, shotCount: 1, turnSeat: 1 }, true)).toBe(
      0,
    );
    expect(defaults.update(createInitialState("eight-ball"), true)).toBe(0);
  });

  it("AI 或回放中不抢球杆，恢复操作时初始化；自由球确认后才选目标", () => {
    const defaults = createDefaultAim();
    const state = position([ball(0, 0, 0), ball(1, 0, 0.3)]);
    expect(defaults.update(state, false)).toBeNull();
    expect(defaults.update(state, true)).toBeCloseTo(Math.PI / 2);
    expect(defaults.update({ ...state, ballInHand: true }, true)).toBeNull();
    const placed = { ...state, balls: [ball(0, -0.3, 0.3), ball(1, 0, 0.3)] };
    expect(defaults.update(placed, true)).toBe(0);
    expect(defaults.update(placed, true)).toBeNull();
  });
});
