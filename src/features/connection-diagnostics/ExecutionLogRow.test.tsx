// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiagnosticOperation, DiagnosticText } from "~/bindings";
import { messages } from "~/locales/zh-CN/messages";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    state,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    search: { operation: string };
    state: { activityLogDetail: boolean };
  }) => (
    <a
      href={`${to}?operation=${search.operation}`}
      data-detail-history={state.activityLogDetail}
      {...props}
    >
      {children}
    </a>
  ),
}));

import ExecutionLogRow from "./ExecutionLogRow";
import ExecutionLogStatus from "./ExecutionLogStatus";

const empty: DiagnosticText = {
  text: "",
  encoding: "utf8",
  receivedBytes: 0,
  capturedBytes: 0,
  redacted: false,
  truncated: false,
  end: "complete",
};
const operation: DiagnosticOperation = {
  id: "hidden-operation-id",
  source: "ssh",
  action: "connect",
  target: "demo@192.0.2.10:22",
  correlationId: null,
  trace: null,
  progress: null,
  discardedDetails: 0,
  metadataTruncated: false,
  redacted: false,
  startedAt: 1,
  elapsedMs: 0,
  status: "passed",
  phase: "finished",
  details: [],
  error: null,
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.load("zh-CN", messages);
  i18n.activate("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(node: React.ReactNode) {
  await act(async () =>
    root.render(<I18nProvider i18n={i18n}>{node}</I18nProvider>),
  );
}

describe("日志行与简短结果", () => {
  it("没有实际内容的摘要行不可点击且不显示详情标识", async () => {
    await render(<ExecutionLogRow operation={operation} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("[data-log-detail]")).toBeNull();
    expect(container.textContent).not.toContain(operation.id);
  });

  it("实际内容或结构化错误才提供详情链接，隐藏内部标识", async () => {
    await render(
      <ExecutionLogRow
        operation={{
          ...operation,
          trace: { ...empty, text: "Session::handshake" },
        }}
      />,
    );
    expect(
      container.querySelector("a")?.getAttribute("data-detail-history"),
    ).toBe("true");
    expect(container.querySelector("a")?.getAttribute("aria-label")).toBe(
      "查看日志：连接主机",
    );
    expect(container.textContent).not.toContain(operation.id);
  });

  it("成功 HTTP 列表展示响应码，详情标题展示成功", async () => {
    const http = {
      ...operation,
      details: [
        {
          kind: "httpResponse" as const,
          status: 204,
          headers: [],
          headersTruncated: false,
          body: empty,
        },
      ],
    };
    await render(<ExecutionLogStatus operation={http} />);
    expect(container.textContent).toBe("204");
    await render(
      <ExecutionLogStatus operation={http} showResponseCode={false} />,
    );
    expect(container.textContent).toBe("成功");
  });

  it("失败不被已采集的 HTTP 响应码掩盖，零状态码不伪造响应", async () => {
    await render(
      <ExecutionLogStatus
        operation={{
          ...operation,
          status: "failed",
          details: [
            {
              kind: "httpResponse",
              status: 200,
              headers: [],
              headersTruncated: false,
              body: empty,
            },
          ],
        }}
      />,
    );
    expect(container.textContent).toBe("失败");
    await render(
      <ExecutionLogStatus
        operation={{
          ...operation,
          details: [
            {
              kind: "httpResponse",
              status: 0,
              headers: [],
              headersTruncated: false,
              body: empty,
            },
          ],
        }}
      />,
    );
    expect(container.textContent).toBe("成功");
  });
});
