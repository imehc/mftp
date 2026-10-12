import { describe, expect, it } from "vitest";

import type { ShotSimResult } from "./physics";
import { createBilliardsGame } from "./rules";
import { createSnookerState, reduceSnookerShot, snookerSeat } from "./snooker";
import { applySnookerAction } from "./snooker-actions";
import type { BilliardsMove, SnookerState } from "./types";

const shot = { type: "shot", angle: 0, power: 0.3, followDraw: 0 } as const;

function position(patch: Partial<SnookerState> = {}): SnookerState {
  const state = createSnookerState(15);
  return {
    ...state,
    breakDone: true,
    placementRegion: null,
    balls: state.balls.map((ball) =>
      ball.id === 0
        ? { ...ball, x: -0.5, y: 0.3 }
        : ball.id === 8
          ? { ...ball, x: 0.5, y: 0.3 }
          : ball,
    ),
    ...patch,
  };
}

function result(
  state: SnookerState,
  potted: number[] = [],
  first: number[] = [8],
  patch: Partial<ShotSimResult> = {},
): ShotSimResult {
  return {
    balls: state.balls.map((ball) => ({
      ...ball,
      potted: ball.potted || potted.includes(ball.id),
    })),
    pottedInOrder: potted.filter((id) => id !== 0),
    cuePotted: potted.includes(0),
    frames: [],
    events: [],
    firstContact: first[0] ?? null,
    firstImpact: null,
    facts: {
      firstContacts: first,
      firstContactTime: first.length ? 0.1 : null,
      rails: [],
      crossedHeadString: [],
      touchingCue: [],
      frozenRails: [],
    },
    ...patch,
  };
}

function play(
  state: SnookerState,
  potted: number[] = [],
  first: number[] = [8],
) {
  return reduceSnookerShot(state, result(state, potted, first), shot);
}

function choose(
  state: SnookerState,
  choice: Extract<BilliardsMove, { type: "decision" }>["choice"],
) {
  return applySnookerAction(state, { type: "decision", choice });
}

describe("斯诺克得分与彩球流程", () => {
  it("一杆多红计分后必须指定彩球，合法彩球复位并续杆", () => {
    const red = play(position(), [8, 9], [8, 9]);
    expect(red.scores).toEqual([2, 0]);
    expect(red.on).toEqual({ kind: "color", nominated: null });
    expect(red.currentBreak).toBe(2);
    expect(() => play(red, [7], [7])).toThrow();
    const color = applySnookerAction(red, { type: "nominate", ballId: 7 });
    const next = play(color, [7], [7]);
    expect(next.scores).toEqual([9, 0]);
    expect(next.currentBreak).toBe(9);
    expect(next.highestBreaks).toEqual([9, 0]);
    expect(next.balls.find((b) => b.id === 7)?.potted).toBe(false);
    expect(next.on.kind).toBe("red");
  });

  it("末红后仍可选彩，然后按黄绿棕蓝粉黑清彩", () => {
    const initial = position();
    initial.balls = initial.balls.map((b) => ({ ...b, potted: b.id > 8 }));
    let state = play(initial, [8]);
    state = applySnookerAction(state, { type: "nominate", ballId: 7 });
    state = play(state, [7], [7]);
    expect(state.on).toEqual({ kind: "clearance", color: 2 });
    for (const id of [2, 3, 4, 5, 6, 7]) state = play(state, [id], [id]);
    expect(state.finished).toBe(true);
    expect(state.scores).toEqual([35, 0]);
    expect(state.highestBreaks[0]).toBe(35);
  });

  it("末红犯规消失或末红后选彩未进，直接开始清黄", () => {
    const initial = position();
    initial.balls = initial.balls.map((b) => ({ ...b, potted: b.id > 8 }));
    const foul = play(initial, [8, 0]);
    expect(foul.on).toEqual({ kind: "clearance", color: 2 });
    expect(foul.scores).toEqual([0, 4]);
    const color = applySnookerAction(play(initial, [8]), {
      type: "nominate",
      ballId: 5,
    });
    expect(play(color, [], [5]).on).toEqual({ kind: "clearance", color: 2 });
  });

  it("犯规杆不加进球分，罚分取涉事球最高价值且彩球复位", () => {
    const state = play(position(), [8, 7, 5]);
    expect(state.scores).toEqual([0, 7]);
    expect(state.balls.find((b) => b.id === 8)?.potted).toBe(true);
    expect(state.balls.find((b) => b.id === 7)?.potted).toBe(false);
    expect(state.balls.find((b) => b.id === 5)?.potted).toBe(false);
    expect(state.lastOutcome?.foul).toBe("wrong-ball-potted");
  });

  it("错彩和同时首碰非法球按价值罚分，普通犯规不赋予手中球", () => {
    const state = position({ on: { kind: "color", nominated: 5 } });
    const next = play(state, [], [5, 7]);
    expect(next.scores).toEqual([0, 7]);
    expect(next.ballInHand).toBe(false);
    expect(snookerSeat(next)).toBe(1);
    expect(choose(next, "return").turnSeat).toBe(0);
  });

  it("母球落袋只获得D区手中球，可多次调整直到出杆", async () => {
    const foul = choose(play(position(), [0]), "accept");
    expect(foul.placementRegion).toBe("d");
    expect(() =>
      applySnookerAction(foul, { type: "place-cue", x: 0.3, y: 0 }),
    ).toThrow();
    const placed = applySnookerAction(foul, {
      type: "place-cue",
      x: -1.2,
      y: 0.12,
    });
    expect(placed.ballInHand).toBe(false);
    expect(placed.placementRegion).toBe("d");
    expect(
      applySnookerAction(placed, { type: "reposition-cue" }).ballInHand,
    ).toBe(true);
    const game = createBilliardsGame("snooker", async () => result(placed));
    const resolution = await game.applyMove(placed, shot, placed.turnSeat);
    expect(
      resolution.state.variant === "snooker" &&
        resolution.state.placementRegion,
    ).toBe(null);
  });
});

describe("斯诺克自由球与贴球", () => {
  it("自由球与红球同进逐球计分，自由球复位", () => {
    const state = position({ freeBall: true, nominatedFree: 7 });
    const next = play(state, [7, 8, 9], [7, 8]);
    expect(next.scores).toEqual([3, 0]);
    expect(next.balls.find((b) => b.id === 7)?.potted).toBe(false);
    expect(next.on.kind).toBe("color");
  });

  it("清彩自由球与目标同进只计一次，目标留袋而自由球复位", () => {
    const state = position({
      on: { kind: "clearance", color: 2 },
      freeBall: true,
      nominatedFree: 7,
    });
    const next = play(state, [2, 7], [7, 2]);
    expect(next.scores).toEqual([2, 0]);
    expect(next.on).toEqual({ kind: "clearance", color: 3 });
    expect(next.balls.find((b) => b.id === 2)?.potted).toBe(true);
    expect(next.balls.find((b) => b.id === 7)?.potted).toBe(false);
    const freeOnly = play(state, [7], [7]);
    expect(freeOnly.on).toEqual({ kind: "clearance", color: 2 });
  });

  it("提名自由球后只先碰原目标仍犯规，要求重打撤销新自由球", () => {
    const state = position({ freeBall: true, nominatedFree: 7 });
    const next = play(state, [], [8]);
    expect(next.lastScore?.penalty).toBe(4);
    const returned = choose(next, "return");
    expect(returned.freeBall).toBe(false);
    expect(returned.nominatedFree).toBe(null);
  });

  it("向外离开合法贴球无需另碰球，向贴球方向击打判推球", () => {
    const state = position();
    state.balls = state.balls.map((b) =>
      b.id === 8 ? { ...b, x: -0.4475, y: 0.3 } : b,
    );
    const sim = result(state, [], []);
    sim.facts.touchingCue = [8];
    const away = reduceSnookerShot(state, sim, { ...shot, angle: Math.PI });
    expect(away.lastOutcome?.foul).toBe(null);
    expect(away.lastScore?.miss).toBe(false);
    expect(reduceSnookerShot(state, sim, shot).lastOutcome?.foul).toBe(
      "touching-ball-moved",
    );
  });

  it("向非法贴球击打同样构成推球，按该球价值处罚", () => {
    const state = position();
    const sim = result(state, [], [8]);
    state.balls = state.balls.map((b) =>
      b.id === 7 ? { ...b, x: -0.4475, y: 0.3 } : b,
    );
    sim.facts.touchingCue = [7];
    const next = reduceSnookerShot(state, sim, shot);
    expect(next.lastScore?.penalty).toBe(7);
  });
});

describe("斯诺克漏击决策和终局", () => {
  it("原位重打恢复球位，保留罚分与杆数，第二次重打前警告第三次判负", () => {
    const initial = position();
    let state = play(initial, [], []);
    expect(state.lastScore?.miss).toBe(true);
    state = choose(state, "replace");
    expect(state.balls).toEqual(initial.balls);
    expect(state.scores).toEqual([0, 4]);
    state = choose(play(state, [], []), "replace");
    expect(state.decision?.kind === "foul" && state.decision.warning).toBe(
      "three-miss",
    );
    expect(snookerSeat(state)).toBe(0);
    state = choose(state, "acknowledge");
    expect(state.decision).toBe(null);
    expect(state.turnSeat).toBe(0);
    state = play(state, [], []);
    expect(state.finished).toBe(true);
    expect(state.winnerSeat).toBe(1);
    expect(state.shotCount).toBe(3);
    expect(state.scores).toEqual([0, 12]);
  });

  it("原位恢复选彩机会，留下位置重打结束漏击序列", () => {
    const initial = position({ on: { kind: "color", nominated: 7 } });
    const miss = play(initial, [], []);
    expect(choose(miss, "replace").on).toEqual({
      kind: "color",
      nominated: null,
    });
    expect(choose(miss, "return").missRun).toBe(null);
  });

  it("首次需要罚分时不判自动漏击，已开始的整球漏击序列不受后来超分影响", () => {
    const initial = position({ scores: [0, 200] });
    expect(play(initial, [], []).lastScore?.miss).toBe(false);
    const previous = {
      ...initial,
      missRun: {
        shooter: 0,
        count: 1,
        fullBallFailures: 1,
        warned: false,
        sixWarned: false,
      },
    };
    expect(play(previous, [], []).lastScore?.miss).toBe(true);
  });

  it("完全被障碍遮挡时只判普通犯规", () => {
    const initial = position();
    initial.balls = initial.balls.map((b) =>
      b.id >= 9
        ? { ...b, potted: true }
        : b.id === 7
          ? { ...b, x: 0, y: 0.3 }
          : b,
    );
    const next = play(initial, [], []);
    expect(next.lastOutcome?.foul).toBe("no-contact");
    expect(next.lastScore?.miss).toBe(false);
    expect(next.decision?.kind === "foul" && next.decision.replace).toBe(null);
  });

  it("黑球首个进球或犯规结束，打成同分则抽签复位并在D区开球", () => {
    const initial = position({
      on: { kind: "clearance", color: 7 },
      scores: [0, 7],
    });
    initial.balls = initial.balls.map((b) => ({
      ...b,
      potted: b.id !== 0 && b.id !== 7,
    }));
    const tied = play(initial, [7], [7]);
    expect(tied.finished).toBe(false);
    expect(tied.scores).toEqual([7, 7]);
    expect(tied.decision?.kind).toBe("black-choice");
    expect(tied.decision).toEqual(play(initial, [7], [7]).decision);
    const next = choose(tied, "return");
    expect(next.turnSeat).toBe(1 - snookerSeat(tied));
    expect(next.placementRegion).toBe("d");
    expect(next.ballInHand).toBe(true);
    const placed = applySnookerAction(next, {
      type: "place-cue",
      x: -1.2,
      y: 0.1,
    });
    const ended = play(placed, [0], []);
    expect(ended.finished).toBe(true);
    expect(ended.winnerSeat).toBe(1 - placed.turnSeat);
  });

  it("仅超分不会提前结束，认输和仅黑球结束由显式动作触发", () => {
    const initial = position({ scores: [200, 0] });
    expect(play(initial).finished).toBe(false);
    expect(applySnookerAction(initial, { type: "concede" }).winnerSeat).toBe(1);
    expect(() =>
      applySnookerAction(initial, { type: "claim-frame" }),
    ).toThrow();
    expect(
      applySnookerAction(
        { ...initial, on: { kind: "clearance", color: 7 } },
        { type: "claim-frame" },
      ).winnerSeat,
    ).toBe(0);
  });

  it("未轮到的座位、等待决策时出杆和不合法指定不会推进状态", async () => {
    const initial = position();
    const game = createBilliardsGame("snooker", async () => result(initial));
    await expect(game.applyMove(initial, shot, 1)).rejects.toThrow();
    const foul = play(initial, [], []);
    await expect(game.applyMove(foul, shot, 1)).rejects.toThrow();
    expect(() =>
      applySnookerAction(initial, { type: "nominate-free", ballId: 8 }),
    ).toThrow();
    expect(initial.shotCount).toBe(0);
  });
});
