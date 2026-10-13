import { describe, expect, it } from "vitest";

import type { MatchSnapshot } from "../engine/match";
import { createNineBallState } from "./nine-ball";
import {
  canSubmitRuleMove,
  reconcileRulePanel,
  type RulePanelState,
  rulePromptKey,
} from "./rule-panel-state";
import { createSnookerState } from "./snooker";
import { applySnookerAction, validateSnookerShot } from "./snooker-actions";
import type { BilliardsState, RedCount, SnookerState } from "./types";

const closed: RulePanelState = { scope: "", prompted: null, panel: null };
const shot = { type: "shot", angle: 0, power: 0.3, followDraw: 0 } as const;

function nomination(reds: RedCount = 15): SnookerState {
  return {
    ...createSnookerState(reds),
    on: { kind: "color", nominated: null },
    shotCount: 1,
    ballInHand: false,
    placementRegion: null,
  };
}

describe("台球规则弹层生命周期", () => {
  it.each([6, 10, 15] as const)(
    "%i 红球未选彩只提示一次，关闭不能绕过击球校验",
    (reds) => {
      const state = nomination(reds);
      const prompt = rulePromptKey(state, 1, true);
      const opened = reconcileRulePanel(closed, "1:awaiting", prompt);
      expect(opened.panel).toBe("target");
      const dismissed = { ...opened, panel: null };
      expect(reconcileRulePanel(dismissed, "1:awaiting", prompt)).toBe(
        dismissed,
      );
      expect(() => validateSnookerShot(state, shot)).toThrow(
        "nominate a colour first",
      );
      const nominated = applySnookerAction(state, {
        type: "nominate",
        ballId: 5,
      });
      expect(() => validateSnookerShot(nominated, shot)).not.toThrow();
    },
  );

  it("未选彩时放置母球不会重新弹回同一提示", () => {
    const state = {
      ...nomination(),
      ballInHand: true,
      placementRegion: "table" as const,
    };
    const prompt = rulePromptKey(state, 4, true);
    const opened = reconcileRulePanel(closed, "4", prompt);
    const next = applySnookerAction(state, {
      type: "place-cue",
      x: -0.5,
      y: 0.3,
    });
    expect(next.ballInHand).toBe(false);
    expect(
      reconcileRulePanel(
        { ...opened, panel: null },
        "5",
        rulePromptKey(next, 5, true),
      ).panel,
    ).toBe(null);
    expect(() => validateSnookerShot(next, shot)).toThrow(
      "nominate a colour first",
    );
  });

  it("相同类型的新决策仍独立提示，AI 和可选自由球不强制提示", () => {
    const state = {
      ...createNineBallState(),
      decision: { kind: "push-out" as const, seat: 0, shooter: 1 },
    };
    const first = reconcileRulePanel(
      closed,
      "3",
      rulePromptKey(state, 3, true),
    );
    expect(first.panel).toBe("rules");
    expect(
      reconcileRulePanel(
        { ...first, panel: null },
        "6",
        rulePromptKey(state, 6, true),
      ).panel,
    ).toBe("rules");
    expect(rulePromptKey(state, 6, false)).toBe(null);
    expect(
      rulePromptKey({ ...createSnookerState(6), freeBall: true }, 6, true),
    ).toBe(null);
  });

  it("回合、重开和结束会清理旧面板及认输确认", () => {
    for (const panel of ["rules", "target", "details", "concede"] as const) {
      const previous = { ...closed, scope: "old", panel };
      expect(reconcileRulePanel(previous, "next", null).panel).toBe(null);
      expect(reconcileRulePanel(previous, "finished", null).panel).toBe(null);
    }
    expect(rulePromptKey({ ...nomination(), finished: true }, 3, true)).toBe(
      null,
    );
  });

  it("新一杆再次进入选彩会获得新的提示", () => {
    const state = nomination();
    const first = reconcileRulePanel(
      closed,
      "1",
      rulePromptKey(state, 1, true),
    );
    const next = { ...state, shotCount: 3 };
    expect(
      reconcileRulePanel(
        { ...first, panel: null },
        "5",
        rulePromptKey(next, 5, true),
      ).panel,
    ).toBe("target");
  });
});

describe("规则操作提交守卫", () => {
  it("仅当前本地等待输入状态可以提交，旧回合、处理中和结束状态拒绝提交", () => {
    const state = nomination();
    const snapshot: MatchSnapshot<BilliardsState> = {
      state,
      phase: "awaiting-move",
      activeSeat: 0,
      winnerSeat: null,
      moveCount: 1,
    };
    expect(canSubmitRuleMove(snapshot, snapshot, true)).toBe(true);
    expect(canSubmitRuleMove(snapshot, snapshot, false)).toBe(false);
    for (const patch of [
      { state: { ...state } },
      { phase: "resolving" as const },
      { activeSeat: 1 },
      { moveCount: 2 },
      { state: { ...state, finished: true } },
      { activeSeat: null },
    ])
      expect(canSubmitRuleMove(snapshot, { ...snapshot, ...patch }, true)).toBe(
        false,
      );
  });
});
