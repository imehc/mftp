// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSessionDetail, AgentSessionSummary } from "~/bindings";
import * as ipc from "~/lib/ipc";

import { useSessionDetail } from "./use-session-detail";

vi.mock("~/lib/ipc", () => ({
  agentSessionDetail: vi.fn(),
  agentSessionsCancel: vi.fn(),
}));

const session: AgentSessionSummary = {
  key: "fixture",
  agent: "codex",
  sessionId: "fixture-id",
  title: "fixture",
  preview: "",
  cwd: "",
  path: "/fixture/session.jsonl",
  updatedAt: 0,
  createdAt: null,
  messageCount: 1000,
  revision: "first",
  matchIndex: 450,
  model: null,
  archived: false,
  contentAvailability: "full",
};
let root: Root;
let element: HTMLDivElement;
let c: ReturnType<typeof useSessionDetail>;
let unmounted: boolean;

function page(offset: number): AgentSessionDetail {
  return {
    session,
    messages: Array.from(
      { length: Math.min(100, 1000 - offset) },
      (_, index) => ({
        index: offset + index,
        role: "user",
        text: `正文 ${offset + index}`,
        timestamp: null,
        truncated: false,
        model: null,
        images: [],
        continuation: false,
      }),
    ),
    total: 1000,
    nextOffset: offset + 100 < 1000 ? offset + 100 : null,
    complete: true,
  };
}

function Probe() {
  const controller = useSessionDetail(session, "first");
  useEffect(() => {
    c = controller;
  });
  return null;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  vi.mocked(ipc.agentSessionDetail).mockImplementation(
    async (_generation, _key, offset) => page(offset),
  );
  vi.mocked(ipc.agentSessionsCancel).mockResolvedValue();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  unmounted = false;
  await act(async () => root.render(<Probe />));
});

afterEach(async () => {
  if (!unmounted) await act(async () => root.unmount());
  element.remove();
});

describe("对话分页阅读窗口", () => {
  it("先定位命中页，再前后加载，不因裁掉尾部而跳过记录", async () => {
    expect(c.firstOffset).toBe(400);
    for (let i = 0; i < 4; i++) await act(async () => c.loadMore());
    expect(c.result?.messages).toHaveLength(400);
    expect(c.firstOffset).toBe(500);
    await act(async () => c.loadEarlier());
    expect(c.firstOffset).toBe(400);
    expect(c.result?.messages.at(-1)?.index).toBe(799);
    expect(c.result?.nextOffset).toBe(800);
    await act(async () => c.loadMore());
    expect(c.result?.messages.map((message) => message.index)).toEqual(
      Array.from({ length: 400 }, (_, index) => 500 + index),
    );
  });

  it("加载失败保留已有正文和游标，用户可以重新加载", async () => {
    vi.mocked(ipc.agentSessionDetail).mockRejectedValueOnce(
      new Error("fixture failure"),
    );
    await act(async () => c.loadMore());
    expect(c.error).not.toBeNull();
    expect(c.result?.messages[0].index).toBe(400);
    expect(c.result?.nextOffset).toBe(500);
    await act(async () => c.loadMore());
    expect(c.error).toBeNull();
    expect(c.result?.messages).toHaveLength(200);
  });

  it("重复加载不启动并发请求，离开后取消并忽略迟到正文", async () => {
    let resolve!: (detail: AgentSessionDetail) => void;
    vi.mocked(ipc.agentSessionDetail).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = c.loadMore();
    });
    await act(async () => c.loadMore());
    expect(ipc.agentSessionDetail).toHaveBeenCalledTimes(2);
    const requestId = vi.mocked(ipc.agentSessionDetail).mock.calls.at(-1)![3];
    await act(async () => root.unmount());
    unmounted = true;
    await act(async () => {
      resolve(page(500));
      await pending;
    });
    expect(ipc.agentSessionsCancel).toHaveBeenCalledWith(requestId);
    expect(c.result?.messages).toHaveLength(100);
  });
});
