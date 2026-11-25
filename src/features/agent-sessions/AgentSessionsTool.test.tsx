// @vitest-environment happy-dom
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import QueryProvider from "~/app/QueryProvider";
import type {
  AgentSessionsSnapshot,
  AgentSessionStorage,
  SessionAgent,
} from "~/bindings";
import { TooltipProvider } from "~/components/ui/tooltip";
import * as ipc from "~/lib/ipc";
import { createAppQueryClient } from "~/lib/query-client";

import AgentSessionsTool from "./AgentSessionsTool";
import { agentSourcesQuery, agentStorageQuery } from "./queries";

vi.mock("~/lib/ipc", () => ({
  agentSessionsSnapshot: vi.fn(),
  agentSessionsStorage: vi.fn(),
  agentSessionsQuery: vi.fn(),
  agentSessionsCancel: vi.fn(),
}));

vi.mock("~/components/AppPageLayout", () => ({
  default: ({
    actions,
    children,
  }: {
    actions: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      {actions}
      {children}
    </main>
  ),
}));

i18n.load("zh-CN", {});
i18n.activate("zh-CN");

const agents: SessionAgent[] = [
  "claude",
  "codex",
  "workbuddy",
  "opencode",
  "copilot",
  "qoder",
  "codebuddy",
];
const snapshot: AgentSessionsSnapshot = {
  generation: "fixture",
  scannedAt: 0,
  total: 7,
  sources: agents.map((agent) => ({
    agent,
    root: `/fixture/${agent}`,
    available: true,
    count: 1,
  })),
  issues: [],
  complete: true,
};
const storage: AgentSessionStorage = {
  generation: "fixture",
  sources: agents.map((agent) => ({
    agent,
    bytes: 1024 * 1024,
    allocatedBytes: 1024 * 1024,
    complete: true,
  })),
  items: [],
  complete: true,
};
const client = createAppQueryClient();
let root: Root;
let element: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  client.setQueryData(agentSourcesQuery().queryKey, snapshot);
  client.setQueryData(agentStorageQuery("fixture").queryKey, storage);
  vi.mocked(ipc.agentSessionsQuery).mockResolvedValue({
    generation: "fixture",
    items: [],
    total: 0,
    nextOffset: null,
    complete: true,
    issues: [],
  });
  vi.mocked(ipc.agentSessionsCancel).mockResolvedValue();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  element.remove();
  vi.unstubAllGlobals();
});

describe("Agent 会话原页面布局", () => {
  it("统计接入原三栏，十五rem来源列保留七种完整品牌名称", async () => {
    await act(async () =>
      root.render(
        <QueryProvider client={client}>
          <I18nProvider i18n={i18n}>
            <TooltipProvider>
              <AgentSessionsTool />
            </TooltipProvider>
          </I18nProvider>
        </QueryProvider>,
      ),
    );
    const grid = Array.from(element.querySelectorAll("div")).find((node) =>
      node.className.includes(
        "@[56rem]/session:grid-cols-[15rem_20rem_minmax(0,1fr)]",
      ),
    );
    expect(grid).toBeDefined();
    const names = Array.from(
      element.querySelectorAll('[data-slot="agent-source-name"]'),
    );
    expect(names.map((name) => name.textContent)).toEqual([
      "Claude Code",
      "Codex",
      "WorkBuddy",
      "OpenCode",
      "VS Code Copilot",
      "Qoder",
      "CodeBuddy",
    ]);
    expect(names.every((name) => !name.className.includes("truncate"))).toBe(
      true,
    );
    expect(
      element.querySelector('[aria-label="会话数量：1；会话存储占用：1.0 MB"]'),
    ).not.toBeNull();
    expect(element.querySelector('[role="dialog"]')).toBeNull();
  });
});
