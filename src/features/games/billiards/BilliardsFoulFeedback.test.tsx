import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messages as englishMessages } from "~/locales/en/messages";

import { FoulSummary } from "./BilliardsFoulFeedback";
import { createNineBallState } from "./nine-ball";
import { NineBallActions } from "./NineBallHud";
import { createSnookerState } from "./snooker";
import { SnookerActions } from "./SnookerHud";
import type { BilliardsMode, NineBallDecision, SnookerState } from "./types";

const ai: BilliardsMode = {
  kind: "ai",
  difficulty: "easy",
  playerBreaks: true,
};

const noop = () => {};

function rendered(children: ReactNode, locale = "zh-CN") {
  const i18n = setupI18n({
    locale,
    messages: { "zh-CN": {}, en: englishMessages },
  });
  return renderToStaticMarkup(
    <I18nProvider i18n={i18n}>{children}</I18nProvider>,
  )
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ");
}

function foulState(shooter: number): SnookerState {
  return {
    ...createSnookerState(15),
    turnSeat: 1 - shooter,
    lastOutcome: {
      shooter,
      foul: "no-contact",
      potted: [],
      continueTurn: false,
      respottedEight: false,
    },
    lastScore: { points: 0, penalty: 4, miss: false, respotted: [] },
    decision: {
      kind: "foul",
      seat: 1 - shooter,
      shooter,
      replace: null,
      anywhere: false,
      warning: null,
    },
  };
}

describe("斯诺克犯规说明身份", () => {
  it("对方犯规时明确显示 电脑 犯规，由你选择接打", () => {
    const text = rendered(
      <SnookerActions state={foulState(1)} mode={ai} enabled onMove={noop} />,
    );
    expect(text).toContain("电脑 犯规，你 获得 4 分。");
    expect(text).toContain("由 你 选择接打，或要求 电脑 从留下位置重打。");
    expect(text).not.toContain("你 · 犯规");
    expect(text).not.toContain("对手获罚分");
  });

  it("自己犯规时明确罚分加给 电脑，同屏双人使用玩家编号", () => {
    const state = foulState(0);
    expect(
      rendered(
        <SnookerActions
          state={state}
          mode={ai}
          enabled={false}
          onMove={noop}
        />,
      ),
    ).toContain("你 犯规，电脑 获得 4 分。");
    expect(
      rendered(
        <SnookerActions
          state={state}
          mode={{ kind: "hotseat" }}
          enabled
          onMove={noop}
        />,
      ),
    ).toContain("玩家 1 犯规，玩家 2 获得 4 分。");
  });

  it.each(["three-miss", "six-red"] as const)(
    "%s 警告明确指向犯规者而非确认者",
    (warning) => {
      const state = foulState(1);
      if (state.decision?.kind !== "foul") throw new Error("缺少犯规决策");
      state.decision.warning = warning;
      const text = rendered(
        <SnookerActions state={state} mode={ai} enabled onMove={noop} />,
      );
      expect(text).toContain(
        warning === "three-miss"
          ? "电脑 可整球直击却连续两次漏击"
          : "电脑 已原位连续漏击四次。第五次后 你 可能获得全台手中球。",
      );
    },
  );

  it("漏击说明区分重打者与选择者", () => {
    const state = foulState(1);
    state.lastScore!.miss = true;
    expect(
      rendered(
        <SnookerActions state={state} mode={ai} enabled onMove={noop} />,
      ),
    ).toContain("本杆判为漏击。由 你 选择接打、要求 电脑 从留下位置重打");
  });

  it("同分黑球明确显示抽签者，不将抽签者说成犯规者", () => {
    const state: SnookerState = {
      ...foulState(1),
      decision: { kind: "black-choice", seat: 0 },
    };
    const text = rendered(
      <SnookerActions state={state} mode={ai} enabled onMove={noop} />,
    );
    expect(text).toContain("电脑 犯规，你 获得 4 分。");
    expect(text).toContain("你 抽签获选，决定谁先打");
  });

  it("缺少旧结果身份时只显示中性罚分", () => {
    expect(
      rendered(
        <FoulSummary
          mode={ai}
          feedback={{
            shooter: null,
            recipient: null,
            penalty: 7,
            reason: "no-contact",
          }}
        />,
      ),
    ).toBe("本杆犯规罚分：7 分");
  });

  it("英文判罚保留犯规者、获分者和分值", () => {
    const text = rendered(
      <SnookerActions state={foulState(1)} mode={ai} enabled onMove={noop} />,
      "en",
    );
    expect(text).toContain("Foul by Computer. 4 points awarded to You.");
    expect(text).toContain(
      "Decision for You: play next or ask Computer to play from the position left.",
    );
    expect(text).not.toContain("[object Object]");
  });
});

describe("九球操作说明身份", () => {
  it.each([
    [
      { kind: "illegal-break", seat: 0, shooter: 1 },
      "电脑 未达到三球开球要求。由 你 选择接受桌面或交回 电脑",
    ],
    [
      { kind: "push-out", seat: 0, shooter: 1 },
      "电脑 推杆结束。由 你 选择接打，或交回 电脑。",
    ],
    [{ kind: "warning", seat: 1 }, "电脑 已连续两次犯规"],
    [
      { kind: "stalemate", seat: 0, proposer: 1 },
      "电脑 提议僵持重摆，由 你 决定是否接受。",
    ],
  ] satisfies [NineBallDecision, string][])(
    "决策 %o 正确区分事件发起人与操作人",
    (decision, expected) => {
      const text = rendered(
        <NineBallActions
          state={{ ...createNineBallState(), decision }}
          mode={ai}
          enabled
          pushOut={false}
          onPushOut={noop}
          onMove={noop}
        />,
      );
      expect(text).toContain(expected);
      expect(text).not.toContain("你 ·");
    },
  );
});
