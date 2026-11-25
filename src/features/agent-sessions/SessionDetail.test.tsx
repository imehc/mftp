// @vitest-environment happy-dom
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSessionDetail, AgentSessionSummary } from "~/bindings";

import { SessionDetail } from "./SessionDetail";
import { useSessionDetail } from "./use-session-detail";

vi.mock("./use-session-detail", () => ({ useSessionDetail: vi.fn() }));

i18n.load("zh-CN", {});
i18n.activate("zh-CN");

const session: AgentSessionSummary = {
  key: "fixture",
  agent: "qoder",
  sessionId: "native-fixture",
  title: "会话 fixture",
  preview: "",
  cwd: "/fixture",
  path: "/fixture/local.db",
  updatedAt: 0,
  createdAt: null,
  messageCount: 8,
  revision: "fixture",
  matchIndex: null,
  model: null,
  archived: false,
  contentAvailability: "encrypted",
};
const detail: AgentSessionDetail = {
  session,
  messages: [
    {
      index: 0,
      role: "tool",
      text: "可读的工具结果：找到目标项目",
      timestamp: null,
      truncated: false,
      model: null,
      images: [],
      continuation: false,
    },
  ],
  total: 1,
  nextOffset: null,
  complete: true,
};
let root: Root;
let container: HTMLDivElement;

function controller(result = detail): ReturnType<typeof useSessionDetail> {
  return {
    result,
    error: null,
    busy: false,
    loadingMore: false,
    firstOffset: 0,
    loadEarlier: vi.fn().mockResolvedValue(undefined),
    loadMore: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn(),
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(useSessionDetail).mockReturnValue(controller());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderDetail({
  selected = session,
  search = "",
  onlyChat = true,
  onOnlyChatChange = vi.fn(),
}: {
  selected?: AgentSessionSummary;
  search?: string;
  onlyChat?: boolean;
  onOnlyChatChange?: (value: boolean) => void;
} = {}) {
  await act(async () => {
    root.render(
      <I18nProvider i18n={i18n}>
        <SessionDetail
          session={selected}
          generation="fixture"
          search={search}
          onlyChat={onlyChat}
          expanded={false}
          onOnlyChatChange={onOnlyChatChange}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );
  });
}

describe("会话正文可读范围", () => {
  it("加密正文在只看对话下说明原因，并提供查看工具与记忆的出口", async () => {
    const onOnlyChatChange = vi.fn();
    await renderDetail({ onOnlyChatChange });
    expect(container.textContent).toContain("对话正文已加密");
    expect(container.textContent).not.toContain("可读的工具结果");
    expect(container.textContent).not.toContain("1–0");
    const action = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看可读记录"),
    );
    expect(action).toBeDefined();
    await act(async () => action?.click());
    expect(onOnlyChatChange).toHaveBeenCalledWith(false);
  });

  it("工具搜索命中在只看对话下仍可见，并直接展开匹配正文", async () => {
    await renderDetail({
      selected: { ...session, matchIndex: 0 },
      search: "目标项目",
    });
    expect(container.textContent).not.toContain("对话正文已加密");
    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.querySelector("mark")?.textContent).toBe("目标项目");
  });

  it("没有可读段时显示零计数，不生成反向阅读范围", async () => {
    vi.mocked(useSessionDetail).mockReturnValue(
      controller({ ...detail, messages: [], total: 0 }),
    );
    await renderDetail({ onlyChat: false });
    expect(container.textContent).toContain("暂无可读记录");
    expect(container.textContent).toContain("0–0 / 0");
    expect(container.textContent).not.toContain("1–0");
  });

  it("不完整的会话保留可读正文，并在当前面板显示说明", async () => {
    vi.mocked(useSessionDetail).mockReturnValue(
      controller({ ...detail, complete: false }),
    );
    await renderDetail({ onlyChat: false });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "部分记录损坏、不完整或超过读取上限",
    );
    expect(container.textContent).toContain("可读的工具结果");
  });
});
