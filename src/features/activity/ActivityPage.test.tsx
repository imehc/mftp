// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityLog, AppError, DiagnosticOperation } from "~/bindings";
import {
  createHistoryController,
  summary,
} from "~/features/logs/__fixtures__/history";
import { messages as enMessages } from "~/locales/en/messages";
import { messages as zhMessages } from "~/locales/zh-CN/messages";

const state = vi.hoisted(() => ({
  search: { tab: "logs", operation: undefined } as {
    tab: "tasks" | "logs";
    operation?: string;
    history?: string;
  },
  operations: [] as DiagnosticOperation[],
  summaries: [] as ActivityLog[],
  historyLoading: false,
  historyError: null as AppError | null,
  loading: false,
  error: null as AppError | null,
  detailHistory: false,
  canGoBack: true,
  buildLocation: vi.fn(() => ({ href: "/activity?tab=logs" })),
  navigate: vi.fn(),
  back: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useSearch: () => state.search,
  useNavigate: () => state.navigate,
  useCanGoBack: () => state.canGoBack,
  useRouter: () => ({
    state: { location: { state: { activityLogDetail: state.detailHistory } } },
    history: { back: state.back },
    buildLocation: state.buildLocation,
    navigate: state.navigate,
  }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("./ActivityProvider", () => ({
  useActivityExecutionLogs: () => ({
    operations: state.operations,
    loading: state.loading,
    error: state.error,
  }),
}));
vi.mock("~/features/logs/use-activity-logs", () => ({
  useActivityLogs: () =>
    createHistoryController({
      logs: state.summaries,
      loading: state.historyLoading,
      error: state.historyError,
    }),
}));
vi.mock("./ActivityCenter", () => ({
  ActivityCenter: () => <div data-activity-center />,
}));
vi.mock("sonner", () => ({ toast: state.toast }));

import ActivityPage from "./ActivityPage";

const operation: DiagnosticOperation = {
  id: "read-directory",
  source: "sftp",
  action: "sftp_list",
  target: "demo@192.0.2.10:22/workspace",
  correlationId: null,
  trace: {
    text: "sftp.readdir /workspace",
    encoding: "utf8",
    receivedBytes: 23,
    capturedBytes: 23,
    redacted: false,
    truncated: false,
    end: "complete",
  },
  progress: null,
  discardedDetails: 0,
  metadataTruncated: false,
  redacted: false,
  startedAt: 1,
  elapsedMs: 10,
  status: "passed",
  phase: "finished",
  details: [],
  error: null,
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  state.search = { tab: "logs", operation: operation.id };
  state.operations = [operation];
  state.summaries = [];
  state.historyLoading = false;
  state.historyError = null;
  state.loading = false;
  state.error = null;
  state.detailHistory = true;
  state.canGoBack = true;
  i18n.load({ "zh-CN": zhMessages, en: enMessages });
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

async function render() {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <ActivityPage />
      </I18nProvider>,
    ),
  );
}

describe("独立日志详情布局与返回", () => {
  it.each(["running", "passed", "failed"] as const)(
    "状态 %s 紧跟标题，不在正文重复摘要",
    async (status) => {
      state.operations = [{ ...operation, status }];
      await render();
      const heading = container.querySelector("h1");
      expect(heading?.textContent).toContain("列出目录");
      expect(heading?.textContent).toContain(
        status === "running" ? "执行中" : status === "failed" ? "失败" : "成功",
      );
      expect(container.querySelectorAll("header")).toHaveLength(1);
      expect(container.querySelector("header p")?.textContent).toBe(
        operation.target,
      );
      expect(
        container.querySelector("[data-log-context]")?.textContent,
      ).toContain("SFTP");
      expect(
        container.querySelector("header")?.querySelectorAll("button"),
      ).toHaveLength(2);
      expect(
        container.querySelector("[data-log-context]")?.textContent,
      ).not.toContain(operation.target);
    },
  );

  it("从列表打开详情后返回原列表历史项", async () => {
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>("header button")?.click(),
    );
    expect(state.back).toHaveBeenCalledOnce();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("直接进入详情时先回日志列表，不跳回其他页面", async () => {
    state.detailHistory = false;
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>("header button")?.click(),
    );
    expect(state.back).not.toHaveBeenCalled();
    expect(state.buildLocation).toHaveBeenCalledWith({
      to: "/activity",
      search: { tab: "logs" },
    });
    expect(state.navigate).toHaveBeenCalledWith({
      search: { tab: "logs" },
      replace: true,
      state: { activityLogDetail: false },
    });
  });

  it("已丢弃记录回退列表并提示，加载期间不误报", async () => {
    state.operations = [];
    state.loading = true;
    await render();
    expect(state.navigate).not.toHaveBeenCalled();
    state.loading = false;
    await render();
    expect(state.toast).toHaveBeenCalledWith("当前列表中未找到这条记录");
    expect(state.navigate).toHaveBeenCalledWith({
      search: { tab: "logs" },
      replace: true,
    });
  });

  it("切换语言后操作名称与状态同步翻译", async () => {
    await render();
    expect(container.querySelector("h1")?.textContent).toContain("列出目录");
    await act(async () => i18n.activate("en"));
    expect(container.querySelector("h1")?.textContent).toContain(
      "List directory",
    );
    expect(container.querySelector("h1")?.textContent).not.toContain(
      "列出目录",
    );
  });

  it("快照读取失败不误判记录已淘汰，恢复权威快照后才回退", async () => {
    state.operations = [];
    state.error = {
      kind: "external",
      code: "diagnostics:read",
      message: "Snapshot unavailable",
      args: {},
    };
    await render();
    expect(state.toast).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    state.error = null;
    await render();
    expect(state.toast).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledWith({
      search: { tab: "logs" },
      replace: true,
    });
  });

  it("淘汰记录只提示一次，语言切换和重绘不会重复播报", async () => {
    state.operations = [];
    await render();
    await act(async () => i18n.activate("en"));
    await render();
    expect(state.toast).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledOnce();
  });

  it("执行详情淘汰后留在同一历史摘要详情页，不误报记录消失", async () => {
    state.summaries = [{ ...summary, operationId: operation.id }];
    await render();
    state.operations = [];
    await render();
    expect(container.textContent).toContain(
      "当前未保留执行详情，历史摘要仍可查看。",
    );
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.toast).not.toHaveBeenCalled();
  });

  it("无关联旧摘要不会被声称曾采集执行详情", async () => {
    state.search = { tab: "logs", history: summary.id };
    state.operations = [];
    state.summaries = [{ ...summary, operationId: null }];
    await render();
    expect(container.textContent).toContain("此操作仅保留摘要。");
    expect(container.textContent).not.toContain("当前未保留执行详情");
  });

  it("任一来源读取失败或仍加载时不误报详情已经释放", async () => {
    state.operations = [];
    state.summaries = [{ ...summary, operationId: operation.id }];
    state.error = {
      kind: "external",
      code: "diagnostics:read",
      message: "Read failed",
      args: {},
    };
    await render();
    expect(container.textContent).toContain("读取执行详情失败");
    expect(container.textContent).not.toContain("当前未保留执行详情");
    expect(state.navigate).not.toHaveBeenCalled();
  });
});
