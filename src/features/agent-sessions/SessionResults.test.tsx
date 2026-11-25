import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentSessionPage, AgentSessionSummary } from "~/bindings";

import { SessionResults } from "./SessionResults";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    measure: vi.fn(),
    measureElement: vi.fn(),
    getTotalSize: () => count * 112,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 112,
      })),
  }),
}));

i18n.load("zh-CN", {});
i18n.activate("zh-CN");

function session(key: string): AgentSessionSummary {
  return {
    key,
    agent: "codex",
    sessionId: key,
    title: `会话 ${key}`,
    preview: "仍可阅读的正文片段",
    cwd: "/fixture",
    path: `/fixture/${key}`,
    updatedAt: 0,
    createdAt: null,
    messageCount: 1,
    revision: key,
    matchIndex: null,
    model: null,
    archived: false,
    contentAvailability: "full",
  };
}

const page: AgentSessionPage = {
  generation: "fixture",
  items: [session("file"), session("database")],
  total: 2,
  nextOffset: null,
  complete: true,
  issues: [],
};

describe("会话列表内联存储占用", () => {
  it("在原副信息行展示文件大小，共享数据库不虚构单个会话大小", () => {
    const html = renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <SessionResults
          page={page}
          selected={null}
          busy={false}
          filtered={false}
          offset={0}
          onSelect={vi.fn()}
          onPage={vi.fn()}
          onClear={vi.fn()}
          sizes={
            new Map([
              ["file", 1024 * 1024],
              ["database", null],
            ])
          }
        />
      </I18nProvider>,
    );
    expect(html).toContain("1.0 MB");
    expect(html).toContain("无法独立计量");
    expect(html).toContain("共享存储无法独立计量");
    expect(html).toContain("仍可阅读的正文片段");
    expect(html).not.toContain("0 B");
    expect(html).toMatch(
      /data-slot="session-storage-size" class="[^"]*text-muted-foreground/,
    );
    expect(html).toContain('<span aria-hidden="true">·</span>');
  });
});
