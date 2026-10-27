import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BoardGameHeader } from "./BoardGameHeader";
import { BoardModeMenu } from "./BoardModeMenu";

vi.mock("~/components/ToolPageHeader", () => ({
  ToolPageHeader: ({
    leading,
    trailing,
  }: {
    leading: ReactNode;
    trailing: ReactNode;
  }) => (
    <header>
      <div data-leading>{leading}</div>
      <div data-trailing>{trailing}</div>
    </header>
  ),
}));
vi.mock("./GameActionsMenu", () => ({
  GameActionsMenu: () => <span data-actions />,
}));

function render(node: ReactNode) {
  return renderToStaticMarkup(
    <I18nProvider
      i18n={setupI18n({ locale: "zh-CN", messages: { "zh-CN": {} } })}
    >
      {node}
    </I18nProvider>,
  );
}

describe("棋类共享页面扩展", () => {
  it("帮助和操作菜单位于右侧插槽，返回按钮仍在左侧", () => {
    const markup = render(
      <BoardGameHeader
        title=""
        active
        finished={false}
        canRestart
        onRestart={() => {}}
        onExit={() => {}}
        help={<span data-help />}
      />,
    );
    expect(markup).toMatch(
      /data-leading[^>]*>.*返回模式选择.*<\/div><div data-trailing[^>]*><span data-help/,
    );
    expect(markup).toContain("data-actions");
    expect(markup.replace(/<[^>]+>/g, "")).not.toContain("trailing=");
  });

  it("军棋隐藏未实现的联机，已有棋类默认保留联机入口", () => {
    const props = {
      gameId: "junqi",
      onStart() {},
      historyMode: () => null,
      historyResult: () => null,
    };
    expect(
      render(<BoardModeMenu {...props} allowOnline={false} />),
    ).not.toContain("局域网联机");
    expect(render(<BoardModeMenu {...props} />)).toContain("局域网联机");
  });
});
