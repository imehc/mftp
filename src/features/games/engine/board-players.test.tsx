import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { boardPlayers } from "./board-players";

const i18n = setupI18n({ locale: "zh-CN", messages: { "zh-CN": {} } });

function text(node: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(
    <I18nProvider i18n={i18n}>{node}</I18nProvider>,
  ).replace(/<[^>]+>/g, "");
}

describe("对局双方身份映射", () => {
  it("电脑后手时玩家在左，电脑在右，回合变化只改变活动侧", () => {
    const localTurn = boardPlayers({
      kind: "ai",
      localSeat: 0,
      activeSeat: 0,
    });
    const computerTurn = boardPlayers({
      kind: "ai",
      localSeat: 0,
      activeSeat: 1,
    });
    expect(text(localTurn.local)).toContain("你执黑");
    expect(text(localTurn.opponent)).toContain("电脑执白");
    expect(text(computerTurn.local)).toBe(text(localTurn.local));
    expect(text(computerTurn.opponent)).toBe(text(localTurn.opponent));
    expect(localTurn.active).toBe("local");
    expect(computerTurn.active).toBe("opponent");
  });

  it("本方后手与国际象棋白方先手分别使用正确棋色", () => {
    const gomoku = boardPlayers({ kind: "ai", localSeat: 1 });
    expect(text(gomoku.local)).toContain("你执白");
    expect(text(gomoku.opponent)).toContain("电脑执黑");
    const chess = boardPlayers({
      kind: "online",
      localSeat: 1,
      firstColor: "white",
    });
    expect(text(chess.local)).toContain("你执黑");
    expect(text(chess.opponent)).toContain("对方执白");
  });

  it("双人使用玩家编号，零分保留并放在对方身份之前", () => {
    const players = boardPlayers({
      kind: "hotseat",
      localSeat: 0,
      firstColor: "red",
      stats: { local: 0, opponent: 0 },
    });
    expect(text(players.local)).toContain("玩家 1执红");
    expect(text(players.local)).toContain(" · 0");
    expect(text(players.opponent)).toMatch(/^0 · /);
    expect(text(players.opponent)).toContain("玩家 2执黑");
    expect(players.active).toBeUndefined();
  });
});
