// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import QueryProvider from "~/app/QueryProvider";
import type { AgentSessionPage, AgentSessionsSnapshot } from "~/bindings";
import * as ipc from "~/lib/ipc";
import { createAppQueryClient } from "~/lib/query-client";

import { useAgentSessions } from "./use-agent-sessions";

vi.mock("~/lib/ipc", () => ({
  agentSessionsSnapshot: vi.fn(),
  agentSessionsQuery: vi.fn(),
  agentSessionsCancel: vi.fn(),
}));

const snapshot: AgentSessionsSnapshot = {
  generation: "first",
  scannedAt: 0,
  sources: ["claude", "codex", "workbuddy", "qoder"].map((agent) => ({
    agent: agent as AgentSessionsSnapshot["sources"][number]["agent"],
    root: "/fixture",
    available: true,
    count: 1,
  })),
  total: 4,
  complete: true,
  issues: [],
};
const empty: AgentSessionPage = {
  generation: "first",
  items: [],
  total: 0,
  nextOffset: null,
  complete: true,
  issues: [],
};
const client = createAppQueryClient();
let root: Root;
let element: HTMLDivElement;
let c: ReturnType<typeof useAgentSessions>;

function Probe() {
  const controller = useAgentSessions();
  useEffect(() => {
    c = controller;
  });
  return null;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  vi.mocked(ipc.agentSessionsSnapshot).mockResolvedValue(snapshot);
  vi.mocked(ipc.agentSessionsQuery).mockResolvedValue(empty);
  vi.mocked(ipc.agentSessionsCancel).mockResolvedValue();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  await act(async () => {
    root.render(
      <QueryProvider client={client}>
        <Probe />
      </QueryProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  element.remove();
});

describe("会话检索生命周期", () => {
  it("来源切换后忽略迟到的旧查询，并向后端取消旧读取", async () => {
    let resolve!: (page: AgentSessionPage) => void;
    vi.mocked(ipc.agentSessionsQuery).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await act(async () => c.setAgent("claude"));
    const oldRequest = vi.mocked(ipc.agentSessionsQuery).mock.calls.at(-1)![1];
    await act(async () => c.setAgent("codex"));
    await act(async () => resolve({ ...empty, total: 99 }));
    expect(c.page?.total).toBe(0);
    expect(ipc.agentSessionsCancel).toHaveBeenCalledWith(oldRequest);
  });

  it("筛选变更重置分页，并且文本结果不进入 Query 缓存", async () => {
    await act(async () => c.setOffset(100));
    await act(async () => c.setAgent("workbuddy"));
    expect(c.offset).toBe(0);
    expect(
      vi.mocked(ipc.agentSessionsQuery).mock.calls.at(-1)![0],
    ).toMatchObject({ agent: "workbuddy", offset: 0 });
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([["agent-sessions", "sources"]]);
  });

  it("刷新失败保留原来的来源快照和成功的读取结果", async () => {
    vi.mocked(ipc.agentSessionsSnapshot).mockRejectedValueOnce(
      new Error("fixture failure"),
    );
    await act(async () => {
      await c.refresh();
    });
    expect(c.sources.data?.generation).toBe("first");
    expect(c.refreshError).not.toBeNull();
  });

  it("刷新后已无记录的分类回到全部会话，重置分页并忽略旧分类", async () => {
    await act(async () => c.setAgent("qoder"));
    await act(async () => c.setOffset(100));
    vi.mocked(ipc.agentSessionsSnapshot).mockResolvedValueOnce({
      ...snapshot,
      generation: "refreshed",
      sources: snapshot.sources.map((source) => ({
        ...source,
        count: source.agent === "qoder" ? 0 : source.count,
      })),
      total: 3,
    });
    await act(async () => c.refresh());
    expect(c.agent).toBe("all");
    expect(c.offset).toBe(0);
    expect(ipc.agentSessionsQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        generation: "refreshed",
        agent: null,
        offset: 0,
      }),
      expect.any(String),
    );
  });

  it("清除筛选同时恢复全部来源、日期和归档状态", async () => {
    await act(async () => {
      c.setAgent("codex");
      c.setArchive("archived");
      c.setRange("month");
    });
    expect(c.filtered).toBe(true);
    await act(async () => c.clearFilters());
    expect(c.agent).toBe("all");
    expect(c.range).toBe("all");
    expect(c.archive).toBe("all");
    expect(c.filtered).toBe(false);
  });
});
