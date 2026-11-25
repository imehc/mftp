import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentSessionsSnapshot } from "~/bindings";
import { TooltipProvider } from "~/components/ui/tooltip";

import { SessionSources } from "./SessionSources";

vi.mock("~/components/ui/tooltip", async (original) => ({
  ...(await original<typeof import("~/components/ui/tooltip")>()),
  // 展开提示正文以验证悬停时展示的内容，不依赖服务端无法执行的鼠标事件。
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <span data-slot="tooltip-content">{children}</span>
  ),
}));

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
        <TooltipProvider>
          <SessionSources
            snapshot={snapshot}
            selected="all"
            onSelect={vi.fn()}
          />
        </TooltipProvider>
      </I18nProvider>,
    );
    expect(html).toContain("全部会话");
    expect(html).not.toContain("Agent 分类");
    expect(html).toContain("OpenCode");
    expect(html).toContain("Qoder");
    expect(html).not.toContain("CodeBuddy");
    expect(html).not.toContain("Copilot");
    expect(html).not.toContain("未发现记录目录");
  });

  it("数量徽标提供占用信息，原品牌名称完整显示且不显示额外统计行", () => {
    const snapshot: AgentSessionsSnapshot = {
      generation: "fixture",
      scannedAt: 0,
      total: 4,
      issues: [],
      complete: true,
      sources: [
        { agent: "codex", root: "/fixture/codex", available: true, count: 1 },
        {
          agent: "copilot",
          root: "/fixture/copilot",
          available: true,
          count: 2,
        },
        { agent: "claude", root: "/fixture/claude", available: true, count: 1 },
      ],
    };
    const html = renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <TooltipProvider>
          <SessionSources
            snapshot={snapshot}
            selected="all"
            onSelect={vi.fn()}
            storage={[
              {
                agent: "codex",
                bytes: 1024 * 1024,
                allocatedBytes: 1024 * 1024,
                complete: true,
              },
              {
                agent: "copilot",
                bytes: 2 * 1024 * 1024,
                allocatedBytes: 2 * 1024 * 1024,
                complete: true,
              },
              {
                agent: "claude",
                bytes: 3 * 1024 * 1024,
                allocatedBytes: 3 * 1024 * 1024,
                complete: true,
              },
            ]}
          />
        </TooltipProvider>
      </I18nProvider>,
    );
    expect(html).toContain('aria-label="会话数量：1；会话存储占用：1.0 MB"');
    expect(html).toContain('aria-label="会话数量：2；会话存储占用：2.0 MB"');
    const tips = [
      ...html.matchAll(/data-slot="tooltip-content">([^<]*)</g),
    ].map((match) => match[1]);
    expect(tips.sort()).toEqual(["1.0 MB", "2.0 MB", "3.0 MB", "6.0 MB"]);
    expect(html).toContain("VS Code Copilot");
    expect(html).toContain("Claude Code");
    expect(html).toContain('data-slot="agent-source-name"');
    expect(html).not.toContain("truncate");
    expect(html).not.toContain("lucide-hard-drive");
    expect(html).toContain('data-slot="tooltip-trigger"');
    expect(html).toContain("6.0 MB");
    expect(html).toContain(">4</span>");
    expect(html).not.toContain(">4 · 6.0 MB</span>");
    expect(html).toContain('aria-label="会话数量：4；会话存储占用：6.0 MB"');
    expect(html).not.toContain("Agent 分类");
  });

  it("已经计量的零占用仍显示数值，不当作未计量", () => {
    const snapshot: AgentSessionsSnapshot = {
      generation: "fixture",
      scannedAt: 0,
      total: 1,
      issues: [],
      complete: true,
      sources: [
        { agent: "codex", root: "/fixture", available: true, count: 1 },
      ],
    };
    const html = renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <TooltipProvider>
          <SessionSources
            snapshot={snapshot}
            selected="all"
            onSelect={vi.fn()}
            storage={[
              { agent: "codex", bytes: 0, allocatedBytes: 0, complete: true },
            ]}
          />
        </TooltipProvider>
      </I18nProvider>,
    );
    expect(html).toContain('aria-label="会话数量：1；会话存储占用：0 B"');
    expect(html).not.toContain("会话存储占用尚未计量");
  });

  it("尚未返回统计时保留会话数量与占位，不误称共享存储", () => {
    const snapshot: AgentSessionsSnapshot = {
      generation: "fixture",
      scannedAt: 0,
      total: 1,
      issues: [],
      complete: true,
      sources: [
        { agent: "claude", root: "/fixture", available: true, count: 1 },
      ],
    };
    const html = renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <TooltipProvider>
          <SessionSources
            snapshot={snapshot}
            selected="all"
            onSelect={vi.fn()}
          />
        </TooltipProvider>
      </I18nProvider>,
    );
    expect(html).toContain("Claude Code");
    expect(html).toContain('aria-label="会话数量：1；会话存储占用：—"');
    expect(html).not.toContain("共享存储");
    expect(html).not.toContain(">1 · ");
  });

  it("统计不完整时全部会话徽标仅显示数量，不展示不完整总量", () => {
    const snapshot: AgentSessionsSnapshot = {
      generation: "fixture",
      scannedAt: 0,
      total: 1,
      issues: [],
      complete: true,
      sources: [
        { agent: "codex", root: "/fixture", available: true, count: 1 },
      ],
    };
    const html = renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <TooltipProvider>
          <SessionSources
            snapshot={snapshot}
            selected="all"
            onSelect={vi.fn()}
            storage={[
              {
                agent: "codex",
                bytes: 1024 * 1024,
                allocatedBytes: 1024 * 1024,
                complete: false,
              },
            ]}
          />
        </TooltipProvider>
      </I18nProvider>,
    );
    expect(html).not.toContain(">1 · ");
    expect(html).toContain('aria-label="会话数量：1；会话存储占用：—"');
    expect(html).not.toContain("Agent 分类");
  });
});
