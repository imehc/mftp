import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { historyResult, ResultLabel } from "./labels";

const i18n = setupI18n({ locale: "zh-CN", messages: { "zh-CN": {} } });

function render(node: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);
}

describe("军棋结果归属", () => {
  it("根据本地阵营区分你或电脑获胜，和棋不受阵营影响", () => {
    expect(render(<ResultLabel winner={1} localSide={1} />)).toBe("你获胜");
    expect(render(<ResultLabel winner={1} localSide={0} />)).toBe("电脑获胜");
    expect(render(<ResultLabel winner={0} localSide={0} />)).toBe("你获胜");
    expect(render(<ResultLabel winner={null} localSide={0} />)).toBe("和棋");
  });

  it("历史结果按记录中的玩家阵营展示", () => {
    expect(
      render(
        historyResult({
          mode: "ai",
          variant: "open",
          winner: 1,
          localSide: 0,
          reason: "flag",
          moves: 4,
        }),
      ),
    ).toBe("电脑获胜");
    expect(
      render(
        historyResult({
          mode: "ai",
          variant: "flip",
          winner: 1,
          localSide: 1,
          reason: "flag",
          moves: 4,
        }),
      ),
    ).toBe("你获胜");
  });
});
