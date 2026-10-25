import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { HomeCategory } from "./entries";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("~/features/activity/ActivityEntry", () => ({
  default: () => <button aria-label="activity" />,
}));
vi.mock("~/store/settings", () => ({
  useSettingsStore: (selector: (state: object) => unknown) =>
    selector({
      showGames: true,
      homeEntryVisibility: {},
      hiddenHomeCategories: [],
      homeEntryOrder: {},
      setShowGames: vi.fn(),
    }),
}));

import HomePage from "./HomePage";

describe("首页标题栏", () => {
  it.each<[HomeCategory, string]>([
    ["tools", "工具"],
    ["library", "文库"],
    ["games", "小游戏"],
  ])("%s 分类仅显示标题，不保留标题旁的应用图标", (category, title) => {
    i18n.loadAndActivate({ locale: "zh-CN", messages: {} });
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <HomePage category={category} />
      </I18nProvider>,
    );
    const header = markup.slice(
      markup.indexOf("<header"),
      markup.indexOf("</header>") + "</header>".length,
    );

    expect(header).toContain(
      `<h1 class="truncate font-semibold text-sm">${title}</h1>`,
    );
    expect(header).not.toContain("<img");
    expect(header).not.toContain("<svg");
    expect(header).toContain('aria-label="activity"');
    expect(markup).toContain("<svg");
  });
});
