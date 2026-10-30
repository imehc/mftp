import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BoardGameHeader } from "./BoardGameHeader";
import { BoardModeMenu } from "./BoardModeMenu";

vi.mock("~/components/ToolPageHeader", () => ({
  ToolPageHeader: ({
    title,
    leading,
    trailing,
  }: {
    title: ReactNode;
    leading: ReactNode;
    trailing: ReactNode;
  }) => (
    <header>
      <div data-title>{title}</div>
      <div data-leading>{leading}</div>
      <div data-trailing>{trailing}</div>
    </header>
  ),
}));
vi.mock("~/features/navigation/BackLink", () => ({
  BackLink: ({ children, ...props }: { children: ReactNode }) => (
    <a data-back-link {...props}>
      {children}
    </a>
  ),
}));
vi.mock("./GameActionsMenu", () => ({
  GameActionsMenu: ({ showMatchActions }: { showMatchActions?: boolean }) => (
    <span data-actions data-show-match={String(showMatchActions ?? true)} />
  ),
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

const base = {
  title: "国际象棋",
  finished: false,
  canRestart: true,
  onRestart() {},
  onExit() {},
};

describe("棋类共享页面扩展", () => {
  it("帮助和操作菜单位于右侧插槽，返回按钮仍在左侧", () => {
    const markup = render(
      <BoardGameHeader {...base} active help={<span data-help />} />,
    );
    expect(markup).toMatch(
      /data-leading[^>]*>.*返回模式选择.*<\/div><div data-trailing[^>]*><span data-help/,
    );
    expect(markup).toContain("data-actions");
  });

  it("未进入对局时返回按钮指向小游戏列表", () => {
    const markup = render(<BoardGameHeader {...base} active={false} />);
    expect(markup).toContain("返回小游戏列表");
    expect(markup).not.toContain("返回模式选择");
  });

  it("横屏对局只保留操作区，不渲染标题与返回", () => {
    const markup = render(
      <BoardGameHeader {...base} active landscape help={<span data-help />} />,
    );
    expect(markup).toContain("game-landscape-nav");
    expect(markup).not.toContain("data-leading");
    expect(markup).not.toContain("data-title");
    expect(markup).toContain("data-actions");
  });

  it("谜题变体常驻更多菜单且不带对局动作", () => {
    const markup = render(
      <BoardGameHeader {...base} active={false} variant="puzzle" />,
    );
    expect(markup).toContain('data-show-match="false"');
    expect(markup).toContain("返回小游戏列表");
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
