import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentSessionsSnapshot } from "~/bindings";

import { SessionSources } from "./SessionSources";

i18n.load("zh-CN", {});
i18n.activate("zh-CN");

describe("本机会话来源分类", () => {
  it("仅显示有记录的品牌，存在空目录和未安装的来源不占分类", () => {
    const snapshot: AgentSessionsSnapshot = {
      generation: "fixture",
      scannedAt: 0,
      total: 5,
      issues: [],
      complete: true,
      sources: [
        { agent: "opencode", root: "/fixture/open", available: true, count: 3 },
        { agent: "qoder", root: "/fixture/qoder", available: true, count: 2 },
        {
          agent: "codebuddy",
          root: "/fixture/empty",
          available: true,
          count: 0,
        },
        {
          agent: "copilot",
          root: "/fixture/missing",
          available: false,
          count: 0,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <SessionSources snapshot={snapshot} selected="all" onSelect={vi.fn()} />
      </I18nProvider>,
    );
    expect(html).toContain("全部会话");
    expect(html).toContain("OpenCode");
    expect(html).toContain("Qoder");
    expect(html).not.toContain("CodeBuddy");
    expect(html).not.toContain("Copilot");
    expect(html).not.toContain("未发现记录目录");
  });
});
