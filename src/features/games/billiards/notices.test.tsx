import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messages as englishMessages } from "~/locales/en/messages";

import { type BilliardsNotice, billiardsNotices } from "./notices";
import { createSnookerState } from "./snooker";
import type { BilliardsMode, SnookerState } from "./types";

const ai: BilliardsMode = {
  kind: "ai",
  difficulty: "easy",
  playerBreaks: true,
};

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

function textOf(notices: BilliardsNotice[]) {
  return rendered(
    <>
      {notices.map((notice) => (
        <div key={notice.id}>
          {notice.title}
          {notice.description}
        </div>
      ))}
    </>,
  );
}

function foulState(): SnookerState {
  return {
    ...createSnookerState(15),
    turnSeat: 1,
    lastOutcome: {
      shooter: 0,
      foul: "no-contact",
      potted: [],
      continueTurn: false,
      respottedEight: false,
    },
    lastScore: { points: 0, penalty: 4, miss: false, respotted: [] },
  };
}

describe("台面状态消息映射", () => {
  it("无异常状态时不产生消息，AI 思考不占消息位", () => {
    expect(billiardsNotices(createSnookerState(15), ai, false)).toEqual([]);
  });

  it("犯规映射为带判罚说明的告警消息", () => {
    const notices = billiardsNotices(foulState(), ai, false);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.id).toMatch(/^foul:/);
    expect(notices[0]!.tone).toBe("warning");
    expect(textOf(notices)).toContain("犯规");
  });

  it("手中球按器材区域生成提示", () => {
    const inD = billiardsNotices(
      { ...createSnookerState(15), placementRegion: "d" },
      ai,
      true,
    );
    expect(textOf(inD)).toContain("D 区");
    const anywhere = billiardsNotices(
      { ...createSnookerState(15), placementRegion: "table" },
      ai,
      true,
    );
    expect(textOf(anywhere)).toContain("全台");
  });

  it("黑八复位映射为一条消息", () => {
    const state: SnookerState = {
      ...createSnookerState(15),
      lastOutcome: {
        foul: null,
        potted: [],
        continueTurn: false,
        respottedEight: true,
      },
    };
    const notices = billiardsNotices(state, ai, false);
    expect(notices.map((notice) => notice.id)).toEqual(["respotted-eight"]);
  });
});
