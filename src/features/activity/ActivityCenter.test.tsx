// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHistoryController } from "~/features/logs/__fixtures__/history";
import { useTransfersStore } from "~/store/transfers";

import { useActivityViewStore } from "./activity-view-store";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("./ActivityProvider", () => ({
  useActivityExecutionLogs: () => ({
    operations: [],
    loading: false,
    error: null,
    discarded: 0,
    clear: vi.fn(),
  }),
}));
vi.mock("~/features/updater/integration", () => ({
  UpdaterActivity: () => null,
}));
vi.mock("./PoetrySyncActivity", () => ({ default: () => null }));
vi.mock("~/features/transfers/runtime/transferRuntime", () => ({
  retryTransferRuntime: vi.fn(),
}));
vi.mock("~/features/transfers/transfer-actions", () => ({
  createTransferActions: () => ({}),
}));

import { ActivityCenter } from "./ActivityCenter";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  i18n.load("zh-CN", {});
  i18n.activate("zh-CN");
  useActivityViewStore.setState({
    tab: "tasks",
    transferFilter: "running",
    filter: "all",
    query: "",
    source: "all",
    range: "all",
    following: true,
    scrollTop: 0,
  });
  useTransfersStore.setState({ transfers: [], runtimeError: undefined });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(tab: "tasks" | "logs") {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <ActivityCenter
          tab={tab}
          onTabChange={() => {}}
          history={createHistoryController()}
        />
      </I18nProvider>,
    ),
  );
}

describe("活动页单行工具栏", () => {
  it.each(["tasks", "logs"] as const)(
    "页签 %s 保留统一页签栏和对应操作菜单",
    async (tab) => {
      await render(tab);
      const toolbar = container.querySelector("[data-activity-toolbar]");
      expect(toolbar?.querySelectorAll("[role=tablist]")).toHaveLength(1);
      expect(toolbar?.querySelectorAll("[role=combobox]")).toHaveLength(
        tab === "tasks" ? 1 : 0,
      );
      expect(toolbar?.querySelectorAll("[aria-haspopup=menu]")).toHaveLength(1);
      expect(container.querySelectorAll("[role=tablist]")).toHaveLength(1);
    },
  );

  it("空日志保留搜索和筛选，不再提供独立历史入口", async () => {
    await render("logs");
    expect(
      container.querySelector(
        "[data-activity-toolbar] a[aria-label='历史日志']",
      ),
    ).toBeNull();
    expect(
      container.querySelector("input[aria-label='搜索日志']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[role=tabpanel]:not([hidden])")?.textContent,
    ).toContain("暂无日志");
  });

  it("任务状态筛选在切换日志页签后保留", async () => {
    await render("tasks");
    await act(async () =>
      useActivityViewStore.getState().setTransferFilter("finished"),
    );
    await render("logs");
    await render("tasks");
    expect(useActivityViewStore.getState().transferFilter).toBe("finished");
    expect(container.querySelector("[role=tabpanel]")?.textContent).toContain(
      "暂无已结束任务",
    );
  });

  it("失败日志筛选无结果时可恢复全部记录", async () => {
    useActivityViewStore.setState({ filter: "failed" });
    await render("logs");
    const button = container.querySelector<HTMLButtonElement>(
      "[role=tabpanel] [data-slot=empty] button",
    );
    expect(button?.textContent).toBe("显示全部");
    await act(async () => button?.click());
    expect(useActivityViewStore.getState().filter).toBe("all");
  });
});
