import { describe, expect, it } from "vitest";

import type { ShotSimResult } from "./physics";
import { createSnookerState, reduceSnookerShot, snookerSeat } from "./snooker";
import { applySnookerAction } from "./snooker-actions";
import type { SnookerState } from "./types";

const shot = { type: "shot", angle: 0, power: 0.3, followDraw: 0 } as const;

function position(): SnookerState {
  const state = createSnookerState(6);
  return {
    ...state,
    breakDone: true,
    placementRegion: null,
    balls: state.balls.map((b) =>
      b.id === 0
        ? { ...b, x: -0.5, y: 0.3 }
        : b.id === 8
          ? { ...b, x: 0.5, y: 0.3 }
          : b.id === 5
            ? { ...b, x: 0, y: 0.33 }
            : { ...b, potted: b.id > 8 },
    ),
  };
}

function miss(state: SnookerState, first: number[] = []) {
  const result: ShotSimResult = {
    balls: state.balls,
    frames: [],
    events: [],
    firstContact: first[0] ?? null,
    firstImpact: null,
    cuePotted: false,
    pottedInOrder: [],
    facts: {
      firstContacts: first,
      firstContactTime: null,
      rails: [],
      touchingCue: [],
      crossedHeadString: [],
      frozenRails: [],
    },
  };
  return reduceSnookerShot(state, result, shot);
}

describe("六红球专用判罚", () => {
  it("只能擦薄边的原位漏击第四次警告，第五次提供全台手中球且不能再恢复原位", () => {
    let state = position();
    for (let i = 1; i <= 4; i++) {
      state = miss(state);
      expect(state.lastScore?.miss).toBe(true);
      expect(state.finished).toBe(false);
      if (i === 4) {
        expect(state.decision?.kind === "foul" && state.decision.warning).toBe(
          "six-red",
        );
        expect(snookerSeat(state)).toBe(0);
        state = applySnookerAction(state, {
          type: "decision",
          choice: "acknowledge",
        });
      }
      state = applySnookerAction(state, {
        type: "decision",
        choice: "replace",
      });
    }
    state = miss(state);
    expect(state.decision?.kind === "foul" && state.decision.anywhere).toBe(
      true,
    );
    expect(() =>
      applySnookerAction(state, { type: "decision", choice: "replace" }),
    ).toThrow();
    state = applySnookerAction(state, { type: "decision", choice: "anywhere" });
    expect(state.placementRegion).toBe("table");
    expect(state.ballInHand).toBe(true);
    expect(state.freeBall).toBe(false);
    expect(state.scores).toEqual([0, 20]);
  });

  it("需要罚分的第五杆不提供全台手中球，十红变体不启用六红特例", () => {
    const before = {
      ...position(),
      missRun: {
        shooter: 0,
        count: 4,
        fullBallFailures: 0,
        warned: false,
        sixWarned: true,
      },
    };
    const exceeded = miss({ ...before, scores: [0, 34] });
    expect(
      exceeded.decision?.kind === "foul" && exceeded.decision.anywhere,
    ).toBe(false);
    const ten = miss({ ...before, reds: 10 });
    expect(ten.decision?.kind === "foul" && ten.decision.anywhere).toBe(false);
    expect(ten.decision?.kind === "foul" && ten.decision.replace).not.toBe(
      null,
    );
  });

  it("六红选彩后不能用指定彩球做有效障碍，罚分按该彩球价值", () => {
    const before = position();
    const state = {
      ...before,
      on: { kind: "color" as const, nominated: 5 },
      balls: before.balls.map((b) => (b.id === 5 ? { ...b, y: 0.3 } : b)),
    };
    const next = miss(state, [5]);
    expect(next.lastOutcome?.foul).toBe("snooker-behind-nomination");
    expect(next.lastScore?.penalty).toBe(5);
    expect(miss({ ...state, reds: 15 }, [5]).lastOutcome?.foul).toBe(null);
  });

  it("自由球做有效障碍罚当前目标分，仅剩粉黑时允许", () => {
    const before = position();
    const free = {
      ...before,
      freeBall: true,
      nominatedFree: 5,
      balls: before.balls.map((b) => (b.id === 5 ? { ...b, y: 0.3 } : b)),
    };
    expect(miss(free, [5]).lastScore?.penalty).toBe(4);
    const last = {
      ...free,
      on: { kind: "clearance" as const, color: 6 },
      nominatedFree: 7,
      balls: [
        { id: 0, x: -0.5, y: 0, potted: false },
        { id: 6, x: 0.5, y: 0, potted: false },
        { id: 7, x: 0, y: 0, potted: false },
      ],
    };
    expect(miss(last, [7]).lastOutcome?.foul).toBe(null);
  });
});
