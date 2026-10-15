import { describe, expect, it } from "vitest";

import { billiardsCheckpointSchema, billiardsStateSchema } from "./checkpoint";
import { foulFeedback } from "./foul-feedback";
import { createNineBallState, reduceNineBallShot } from "./nine-ball";
import type { ShotSimResult } from "./physics";
import { createBilliardsGame, createInitialState } from "./rules";
import { createSnookerState, reduceSnookerShot } from "./snooker";
import { applySnookerAction } from "./snooker-actions";
import type { BilliardsState, SnookerState } from "./types";

const shot = { type: "shot", angle: 0, power: 0.3, followDraw: 0 } as const;

function missedShot(state: BilliardsState): ShotSimResult {
  return {
    balls: state.balls,
    frames: [],
    events: [],
    firstContact: null,
    firstImpact: null,
    cuePotted: false,
    pottedInOrder: [],
    facts: {
      firstContacts: [],
      firstContactTime: null,
      rails: [],
      crossedHeadString: [],
      touchingCue: [],
      frozenRails: [],
    },
  };
}

function snookerFoul(
  shooter: number,
  penalty = 4,
  patch: Partial<SnookerState> = {},
) {
  const state: SnookerState = {
    ...createSnookerState(15, shooter),
    ballInHand: false,
    placementRegion: null,
    on: { kind: "color", nominated: penalty },
    ...patch,
  };
  return reduceSnookerShot(state, missedShot(state), shot);
}

describe("台球上一杆犯规归属", () => {
  it.each([0, 1])(
    "座位 %i 犯规时记录出杆者并将四至七分加给另一方",
    (shooter) => {
      for (const penalty of [4, 5, 6, 7]) {
        const state = snookerFoul(shooter, penalty);
        expect(state.lastOutcome?.shooter).toBe(shooter);
        expect(state.scores[shooter]).toBe(0);
        expect(state.scores[1 - shooter]).toBe(penalty);
        expect(foulFeedback(state)).toEqual({
          shooter,
          recipient: 1 - shooter,
          penalty,
          reason: "no-contact",
        });
      }
    },
  );

  it.each(["accept", "return", "replace"] as const)(
    "选择 %s 后不随下一杆座位改变罚分归属",
    (choice) => {
      const state = snookerFoul(1);
      if (state.decision?.kind !== "foul") throw new Error("缺少犯规决策");
      const saved = createSnookerState(15);
      state.decision.replace = {
        balls: saved.balls,
        on: saved.on,
        placementRegion: saved.placementRegion,
        freeBall: saved.freeBall,
        nominatedFree: saved.nominatedFree,
      };
      const next = applySnookerAction(state, { type: "decision", choice });
      expect(next.decision).toBeNull();
      expect(next.turnSeat).toBe(choice === "accept" ? 0 : 1);
      expect(foulFeedback(next)).toEqual(foulFeedback(state));
      expect(next.lastOutcome).toBe(state.lastOutcome);
    },
  );

  it("终局犯规清除决策后仍保留犯规者和罚分", () => {
    const state = snookerFoul(0, 7, { on: { kind: "clearance", color: 7 } });
    expect(state.finished).toBe(true);
    expect(state.decision).toBeNull();
    expect(foulFeedback(state)).toMatchObject({
      shooter: 0,
      recipient: 1,
      penalty: 7,
    });
  });

  it("黑球犯规后同分抽签不会改变上一杆罚分归属", () => {
    const state = snookerFoul(0, 7, {
      on: { kind: "clearance", color: 7 },
      scores: [7, 0],
    });
    expect(state.decision?.kind).toBe("black-choice");
    expect(foulFeedback(state)).toMatchObject({
      shooter: 0,
      recipient: 1,
      penalty: 7,
    });
  });

  it("旧存档只从明确犯规决策恢复身份，决策消失后不按回合猜测", () => {
    const state = snookerFoul(1);
    delete state.lastOutcome!.shooter;
    expect(billiardsStateSchema.safeParse(state).success).toBe(true);
    expect(foulFeedback(state)?.shooter).toBe(1);
    for (const turnSeat of [0, 1]) {
      expect(
        foulFeedback({ ...state, decision: null, turnSeat }),
      ).toMatchObject({ shooter: null, recipient: null, penalty: 4 });
    }
  });

  it("新存档保留出杆者，非法座位拒绝解析", () => {
    const state = snookerFoul(1);
    expect(billiardsStateSchema.parse(state).lastOutcome?.shooter).toBe(1);
    expect(
      billiardsStateSchema.safeParse({
        ...state,
        lastOutcome: { ...state.lastOutcome, shooter: 2 },
      }).success,
    ).toBe(false);
    const practice = createInitialState("practice");
    const saved = {
      version: 1,
      gameId: "billiards",
      id: crypto.randomUUID(),
      savedAt: Date.now(),
      mode: { kind: "practice" },
      history: [{ ...practice, lastOutcome: state.lastOutcome }],
    };
    expect(billiardsCheckpointSchema.safeParse(saved).success).toBe(false);
  });

  it.each(["eight-ball", "practice"] as const)(
    "%s 结算也记录实际出杆者",
    async (variant) => {
      const state = { ...createInitialState(variant), ballInHand: false };
      const game = createBilliardsGame(variant, async () => missedShot(state));
      const next = await game.applyMove(state, shot, state.turnSeat);
      expect(next.state.lastOutcome?.shooter).toBe(state.turnSeat);
      expect(foulFeedback(next.state)?.penalty ?? 0).toBe(0);
    },
  );

  it("九球犯规记录出杆者且不展示斯诺克罚分", () => {
    const state = {
      ...createNineBallState(1),
      ballInHand: false,
      placementRegion: null,
    };
    const next = reduceNineBallShot(state, missedShot(state));
    expect(next.lastOutcome?.shooter).toBe(1);
    expect(foulFeedback(next)).toMatchObject({
      shooter: 1,
      recipient: null,
      penalty: 0,
    });
    expect(foulFeedback(createSnookerState(15))).toBeNull();
  });
});
