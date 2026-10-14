import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messages as englishMessages } from "~/locales/en/messages";

import { BilliardsRulesDialog } from "./BilliardsRulesDialog";
import type { BilliardsDiscipline } from "./types";

function markup(discipline: BilliardsDiscipline, locale = "zh-CN") {
  const i18n = setupI18n({
    locale,
    messages: {
      "zh-CN": {},
      en: englishMessages,
    },
  });
  return renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <BilliardsRulesDialog discipline={discipline} />
    </I18nProvider>,
  );
}

describe("开局页规则帮助入口", () => {
  it.each(["nine-ball", "snooker"] as const)(
    "%s 显示具名规则图标，默认不展开规则正文",
    (discipline) => {
      const rendered = markup(discipline);
      expect(rendered).toContain('aria-label="查看游戏规则"');
      expect(rendered).toContain('aria-haspopup="dialog"');
      expect(rendered).toContain('data-state="closed"');
      expect(rendered).not.toContain("红彩交替后依次清彩");
      expect(rendered).not.toContain("依次首碰最低号球");
    },
  );

  it("八球不新增无对应说明的规则入口", () => {
    expect(markup("eight-ball")).toBe("");
  });

  it("规则入口名称随语言切换", () => {
    expect(markup("snooker", "en")).toContain('aria-label="View game rules"');
  });
});
