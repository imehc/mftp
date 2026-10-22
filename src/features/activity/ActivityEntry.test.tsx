// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/tools/ssh-sftp",
  summary: {
    failed: 0,
    running: 0,
    updatePending: false,
    logsActive: false,
    tone: null,
    count: null,
    kind: "idle",
    destination: null,
  } as import("./activity-summary").ActivitySummary,
}));
vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => state.pathname,
  Link: ({
    children,
    to,
    search,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    search: { tab: string };
  }) => (
    <a href={`${to}?tab=${search.tab}`} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("./use-activity-summary", () => ({
  useActivitySummary: () => state.summary,
}));

import { useActivityViewStore } from "./activity-view-store";
import ActivityEntry from "./ActivityEntry";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  state.pathname = "/tools/ssh-sftp";
  state.summary = {
    failed: 0,
    running: 0,
    updatePending: false,
    logsActive: false,
    tone: null,
    count: null,
    kind: "idle",
    destination: null,
  };
  useActivityViewStore.setState({ tab: "tasks" });
  i18n.load("zh-CN", {});
  i18n.activate("zh-CN");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(variant: "rail" | "header" = "rail") {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <ActivityEntry variant={variant} />
      </I18nProvider>,
    ),
  );
}

describe("跨页面活动入口", () => {
  it.each(["transfer", "sync", "update", "logs", "mixed"] as const)(
    "活动类型 %s 保持固定活动名称",
    async (kind) => {
      state.summary = {
        ...state.summary,
        kind,
        tone: "running",
        destination: "tasks",
      };
      await render();
      expect(container.querySelector("a")?.dataset.activityKind).toBe(kind);
      expect(container.querySelector("a")?.textContent).toBe("活动");
    },
  );

  it("较早日志失败优先提示错误并进入日志，不被运行任务文案掩盖", async () => {
    state.summary = {
      ...state.summary,
      running: 2,
      logsActive: true,
      tone: "error",
      kind: "mixed",
      destination: "logs",
    };
    await render();
    expect(container.querySelector("a")?.getAttribute("aria-label")).toBe(
      "活动，有操作失败",
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/activity?tab=logs",
    );
    expect(container.querySelector(".text-destructive")).not.toBeNull();
  });

  it("空闲入口保留上次页签，不给成功记录加通知", async () => {
    useActivityViewStore.setState({ tab: "logs" });
    await render();
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/activity?tab=logs",
    );
    expect(container.querySelector(".ring-2")).toBeNull();
  });

  it("活动页不重复显示移动标题栏入口，桌面保持选中", async () => {
    state.pathname = "/activity";
    await render("header");
    expect(container.querySelector("a")).toBeNull();
    await render("rail");
    expect(container.querySelector("a")?.getAttribute("aria-current")).toBe(
      "page",
    );
  });
});
