import { describe, expect, it, vi } from "vitest";

import type { MatchSnapshot } from "../engine/match";
import { subscribeFoulPenalties } from "./foul-notifications";
import { createSnookerState } from "./snooker";
import type { BilliardsState, SnookerState } from "./types";

function penalty(shooter: number, shotCount = 1): SnookerState {
  return {
    ...createSnookerState(15),
    turnSeat: 1 - shooter,
    shotCount,
    lastOutcome: {
      shooter,
      foul: "no-contact",
      potted: [],
      continueTurn: false,
      respottedEight: false,
    },
    lastScore: { points: 0, penalty: 4, miss: false, respotted: [] },
  };
}

function source(
  initial: BilliardsState = createSnookerState(15),
  opponentAi = true,
) {
  let snapshot: MatchSnapshot<BilliardsState> = {
    state: initial,
    phase: "awaiting-move",
    moveCount: initial.shotCount,
    activeSeat: initial.turnSeat,
    winnerSeat: null,
  };
  const listeners = new Set<() => void>();
  return {
    controllers: [
      {
        kind: "local" as const,
        requestMove: async () => ({ type: "concede" as const }),
      },
      {
        kind: opponentAi ? ("ai" as const) : ("local" as const),
        requestMove: async () => ({ type: "concede" as const }),
      },
    ],
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(
      state: BilliardsState,
      patch: Partial<MatchSnapshot<BilliardsState>> = {},
    ) {
      snapshot = {
        ...snapshot,
        state,
        moveCount: snapshot.moveCount + 1,
        ...patch,
      };
      for (const listener of listeners) listener();
    },
  };
}

describe("本地玩家罚分通知", () => {
  it("从旧存档进入不重播，只有新出杆罚分才通知", () => {
    const runner = source(penalty(0));
    const notify = vi.fn();
    const unsubscribe = subscribeFoulPenalties(runner, notify);
    expect(notify).not.toHaveBeenCalled();
    runner.publish(penalty(0), { phase: "resolving", moveCount: 1 });
    expect(notify).not.toHaveBeenCalled();
    runner.publish(penalty(0, 2), { phase: "awaiting-move" });
    expect(notify).toHaveBeenCalledExactlyOnceWith({
      shooter: 0,
      recipient: 1,
      penalty: 4,
      reason: "no-contact",
    });
    unsubscribe();
    runner.publish(penalty(0, 3));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("确认警告、交回、原位重打和快速连续更新不重复通知", () => {
    const runner = source();
    const notify = vi.fn();
    subscribeFoulPenalties(runner, notify);
    const state = penalty(0);
    runner.publish(state);
    for (const turnSeat of [1, 0, 1, 0]) runner.publish({ ...state, turnSeat });
    expect(notify).toHaveBeenCalledTimes(1);
    runner.publish(penalty(0, 2));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("AI 犯规不弹本地罚分通知，同屏双方犯规都通知", () => {
    const notify = vi.fn();
    const ai = source();
    subscribeFoulPenalties(ai, notify);
    ai.publish(penalty(1));
    expect(notify).not.toHaveBeenCalled();
    const hotseat = source(createSnookerState(15), false);
    subscribeFoulPenalties(hotseat, notify);
    hotseat.publish(penalty(1));
    hotseat.publish(penalty(0, 2));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("终局犯规在无待处理决策时仍通知", () => {
    const runner = source();
    const notify = vi.fn();
    subscribeFoulPenalties(runner, notify);
    runner.publish(
      { ...penalty(0), finished: true, winnerSeat: 1 },
      { phase: "finished", activeSeat: null, winnerSeat: 1 },
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("回退不重播历史判罚，回退后新的同编号出杆仍通知", () => {
    const runner = source();
    const notify = vi.fn();
    subscribeFoulPenalties(runner, notify);
    runner.publish(penalty(0));
    runner.publish(createSnookerState(15), { moveCount: 0 });
    expect(notify).toHaveBeenCalledTimes(1);
    runner.publish(penalty(0));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("没有罚分或没有可靠犯规座位时不通知", () => {
    const runner = source();
    const notify = vi.fn();
    subscribeFoulPenalties(runner, notify);
    runner.publish({ ...penalty(0), lastScore: null });
    const legacy = penalty(0, 2);
    delete legacy.lastOutcome!.shooter;
    runner.publish(legacy);
    expect(notify).not.toHaveBeenCalled();
  });
});
