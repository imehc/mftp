import { beforeAll, describe, expect, it } from "vitest";

import { AMERICAN_NINE } from "./equipment";
import {
  applyNineBallAction,
  createNineBallState,
  nineBallSeat,
  reduceNineBallShot,
} from "./nine-ball";
import {
  ensurePhysicsReady,
  type ShotSimResult,
  simulateShot,
} from "./physics";
import { legalCuePlacement, respotNine } from "./placement";
import { createNineBallRack } from "./racks";
import { createBilliardsGame } from "./rules";
import type { BallState, NineBallState } from "./types";

function state(): NineBallState {
  return { ...createNineBallState(), breakDone: true, placementRegion: null };
}

function facts(
  before: NineBallState,
  patch: Partial<ShotSimResult> = {},
): ShotSimResult {
  return {
    balls: before.balls,
    frames: [],
    events: [],
    firstContact: 1,
    firstImpact: null,
    cuePotted: false,
    pottedInOrder: [],
    facts: {
      firstContacts: [1],
      firstContactTime: 0.1,
      rails: [{ ball: 1, rail: 0, t: 0.2 }],
      crossedHeadString: [],
      touchingCue: [],
      frozenRails: [],
    },
    ...patch,
  };
}

function pot(before: NineBallState, ids: number[]): ShotSimResult {
  return facts(before, {
    balls: before.balls.map((b) => ({
      ...b,
      potted: ids.includes(b.id) || b.potted,
    })),
    pottedInOrder: ids,
  });
}

describe("九球摆球与区域", () => {
  it("9号位于脚点且紧密菱形无重叠，保存种子可重现", () => {
    const rack = createNineBallRack(123);
    expect(rack).toEqual(createNineBallRack(123));
    expect(rack).not.toEqual(createNineBallRack(321));
    expect(rack.find((b) => b.id === 9)).toMatchObject({ x: 0.635, y: 0 });
    const targets = rack.filter((b) => b.id);
    expect(targets.reduce((a, b) => (a.x < b.x ? a : b)).id).toBe(1);
    let touching = 0;
    for (let i = 0; i < targets.length; i++)
      for (let j = i + 1; j < targets.length; j++) {
        const distance = Math.hypot(
          targets[i].x - targets[j].x,
          targets[i].y - targets[j].y,
        );
        expect(distance).toBeGreaterThanOrEqual(0.05715 - 1e-12);
        if (distance < 0.05715 + 1e-12) touching++;
      }
    expect(touching).toBe(16);
  });

  it("开球须在头线之后，放置后仍能调整直到出杆", () => {
    const start = createNineBallState();
    expect(legalCuePlacement(start, -0.635, 0)).toBe(false);
    expect(legalCuePlacement(start, -0.636, 0)).toBe(true);
    const moved = applyNineBallAction(start, {
      type: "place-cue",
      x: -0.8,
      y: 0.2,
    });
    expect(moved.placementRegion).toBe("head");
    expect(
      applyNineBallAction(moved, { type: "reposition-cue" }).ballInHand,
    ).toBe(true);
    expect(
      applyNineBallAction(moved, { type: "place-cue", x: -0.9, y: -0.2 })
        .balls[0].x,
    ).toBe(-0.9);
  });

  it("复位先向脚库找最近相切空位，并与母球留隙", () => {
    const ball = (id: number, x: number): BallState => ({
      id,
      x,
      y: 0,
      potted: id === 9,
    });
    const result = respotNine([
      ball(9, 1),
      ball(2, 0.635),
      ball(0, 0.635 + 0.05715),
    ]);
    expect(result[0].x).toBeCloseTo(0.635 + 0.05715 * 2 + 0.0001, 10);
    expect(result[0].potted).toBe(false);
  });

  it("脚库整段被占才退向头库，不交替跳过最近点", () => {
    const occupied = Array.from({ length: 12 }, (_, i) => ({
      id: i + 10,
      x: 0.635 + i * 0.052,
      y: 0,
      potted: false,
    }));
    const result = respotNine([
      ...occupied,
      { id: 9, x: 0, y: 0, potted: true },
    ]);
    expect(result.at(-1)?.x).toBeCloseTo(0.635 - 0.05715, 10);
  });
});

describe("九球客观裁判", () => {
  it("最低号首碰后组合进9号获胜，8号只是普通目标球", () => {
    const before = state();
    expect(reduceNineBallShot(before, pot(before, [9])).winnerSeat).toBe(0);
    expect(reduceNineBallShot(before, pot(before, [8]))).toMatchObject({
      finished: false,
      turnSeat: 0,
    });
  });

  it("同时首碰包括最低号时作有利于击球者的解释", () => {
    const before = state();
    const sim = facts(before);
    sim.facts.firstContacts = [2, 1];
    expect(reduceNineBallShot(before, sim).lastOutcome?.foul).toBeNull();
    sim.facts.firstContacts = [2];
    expect(reduceNineBallShot(before, sim).lastOutcome?.foul).toBe(
      "wrong-first-contact",
    );
  });

  it("无进球时初碰前碰库不算，初碰后碰库有效", () => {
    const before = state();
    const sim = facts(before);
    sim.facts.rails[0].t = 0.05;
    expect(reduceNineBallShot(before, sim).lastOutcome?.foul).toBe("no-rail");
    sim.facts.rails[0].t = 0.1;
    expect(reduceNineBallShot(before, sim).lastOutcome?.foul).toBeNull();
  });

  it("母球落袋使9号复位，其他落袋目标球保留", () => {
    const before = state();
    const sim = { ...pot(before, [2, 9]), cuePotted: true };
    expect(reduceNineBallShot(before, sim)).toMatchObject({
      ballInHand: true,
      placementRegion: "table",
      turnSeat: 1,
      finished: false,
    });
    const after = reduceNineBallShot(before, sim);
    expect(after.balls.find((b) => b.id === 9)?.potted).toBe(false);
    expect(after.balls.find((b) => b.id === 2)?.potted).toBe(true);
  });

  it.each([
    [0, 3],
    [1, 2],
    [2, 1],
    [3, 0],
  ])("开球进%j球加%j个越线满足三球要求", (pottedCount, crossed) => {
    const before = createNineBallState();
    const sim = pot(before, [2, 3, 4].slice(0, pottedCount));
    sim.facts.rails = [1, 2, 3, 4].map((ball) => ({ ball, rail: 0, t: 0.2 }));
    sim.facts.crossedHeadString = [5, 6, 7].slice(0, crossed);
    const after = reduceNineBallShot(before, sim);
    expect(after.decision).toBeNull();
    expect(after.pushOutAvailable).toBe(true);
  });

  it("无进球须四个不同目标碰库；母球和同球重复不凑数", () => {
    const before = createNineBallState();
    const sim = facts(before);
    sim.facts.crossedHeadString = [1, 2, 3];
    sim.facts.rails = [0, 1, 2, 2, 3].map((ball) => ({
      ball,
      rail: 0,
      t: 0.2,
    }));
    expect(reduceNineBallShot(before, sim).lastOutcome?.foul).toBe(
      "illegal-break",
    );
  });

  it("三球不足但无普通犯规时可接受或交回，9号不判胜", () => {
    const before = createNineBallState();
    const after = reduceNineBallShot(before, pot(before, [9]));
    expect(after).toMatchObject({
      finished: false,
      ballInHand: false,
      decision: { kind: "illegal-break", seat: 1 },
    });
    expect(after.lastOutcome?.respottedNine).toBe(true);
    expect(
      applyNineBallAction(after, { type: "decision", choice: "accept" }),
    ).toMatchObject({ turnSeat: 1, pushOutAvailable: false });
    expect(
      applyNineBallAction(after, { type: "decision", choice: "return" }),
    ).toMatchObject({ turnSeat: 0, pushOutAvailable: true });
  });

  it("普通犯规优先于三球不足的选择", () => {
    const before = createNineBallState();
    expect(
      reduceNineBallShot(before, facts(before, { cuePotted: true })),
    ).toMatchObject({ decision: null, ballInHand: true });
  });

  it("推杆免除首碰和碰库，进9复位且对手决定接打或交回", () => {
    const before = { ...state(), pushOutAvailable: true };
    const sim = pot(before, [9]);
    sim.facts.firstContacts = [];
    sim.facts.firstContactTime = null;
    sim.facts.rails = [];
    const after = reduceNineBallShot(before, sim, true);
    expect(after).toMatchObject({
      finished: false,
      decision: { kind: "push-out", seat: 1 },
      lastOutcome: { foul: null },
    });
    expect(nineBallSeat(after)).toBe(1);
    expect(
      applyNineBallAction(after, { type: "decision", choice: "return" }),
    ).toMatchObject({ turnSeat: 0, pushOutAvailable: false });
    expect(
      reduceNineBallShot(before, { ...sim, cuePotted: true }, true),
    ).toMatchObject({ decision: null, ballInHand: true });
  });

  it("两犯警告确认后第三个连续犯规判负，累计犯规不替代连续", () => {
    let before = { ...state(), consecutiveFouls: [1, 0], foulCounts: [6, 0] };
    before = reduceNineBallShot(before, facts(before, { cuePotted: true }));
    expect(before.decision).toEqual({ kind: "warning", seat: 0 });
    before = applyNineBallAction(before, {
      type: "decision",
      choice: "acknowledge",
    });
    expect(before.warned[0]).toBe(true);
    before = { ...before, turnSeat: 0, ballInHand: false };
    expect(
      reduceNineBallShot(before, facts(before, { cuePotted: true })).winnerSeat,
    ).toBe(1);
    const legal = reduceNineBallShot(before, facts(before));
    expect(legal.consecutiveFouls[0]).toBe(0);
    expect(legal.warned[0]).toBe(false);
    expect(legal.foulCounts[0]).toBe(7);
  });

  it("僵持重摆由对手确认并保留本局开球者", () => {
    const before = {
      ...createNineBallState(1, 987),
      turnSeat: 0,
      shotCount: 12,
    };
    const pending = applyNineBallAction(before, { type: "propose-stalemate" });
    expect(nineBallSeat(pending)).toBe(1);
    const after = applyNineBallAction(pending, {
      type: "decision",
      choice: "rerack",
    });
    expect(after).toEqual(createNineBallState(1, 987));
  });

  it("非法动作不调用模拟或推进状态", async () => {
    let called = false;
    const game = createBilliardsGame("nine-ball", (balls) => {
      called = true;
      return facts(state(), { balls: [...balls] });
    });
    const before = state();
    await expect(
      game.applyMove(
        before,
        { type: "shot", angle: 0, power: 0.5, followDraw: 0, pushOut: true },
        0,
      ),
    ).rejects.toThrow();
    await expect(
      game.applyMove(before, { type: "place-cue", x: 0, y: 0 }, 1),
    ).rejects.toThrow();
    expect(called).toBe(false);
    expect(before.shotCount).toBe(0);
  });
});

describe("九球真实紧密开球", () => {
  beforeAll(async () => {
    await ensurePhysicsReady();
  });

  it("真实求解器首先撞击1号，不因接触容差挤飞静止球堆", () => {
    const before = createNineBallState();
    const sim = simulateShot(
      before.balls,
      { angle: 0, power: 1, followDraw: 0 },
      false,
      AMERICAN_NINE,
    );
    expect(sim.facts.firstContacts).toEqual([1]);
    expect(
      sim.balls.every(
        (ball) => Number.isFinite(ball.x) && Number.isFinite(ball.y),
      ),
    ).toBe(true);
    expect(reduceNineBallShot(before, sim).shotCount).toBe(1);
  });
});
