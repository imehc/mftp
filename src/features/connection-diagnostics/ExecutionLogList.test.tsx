// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiagnosticOperation } from "~/bindings";
import { useActivityViewStore } from "~/features/activity/activity-view-store";
import { messages } from "~/locales/zh-CN/messages";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));

import ExecutionLogList from "./ExecutionLogList";
import type { ExecutionLogs } from "./use-execution-logs";

function operation(
  id: string,
  target: string,
  startedAt: number,
  status: DiagnosticOperation["status"] = "passed",
) {
  return {
    id,
    source: "ssh",
    action: "connect",
    target,
    correlationId: null,
    trace: null,
    progress: null,
    discardedDetails: 0,
    metadataTruncated: false,
    redacted: false,
    startedAt,
    elapsedMs: 0,
    status,
    phase: "finished",
    details: [],
    error: null,
  } satisfies DiagnosticOperation;
}

const older = operation("older", "older@192.0.2.10:22", 1);
const newer = operation("newer", "newer@192.0.2.10:22", 2);
const failed = operation("failed", "failed@192.0.2.10:22", 3, "failed");
const logs = {
  operations: [older, newer, failed],
  discarded: 0,
  error: null,
  loading: false,
  clear: async () => {},
  recordFailure: () => {},
} satisfies ExecutionLogs;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  i18n.load("zh-CN", messages);
  i18n.activate("zh-CN");
  useActivityViewStore.setState({
    filter: "all",
    following: true,
    scrollTop: 0,
  });
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
        <ExecutionLogList logs={logs} />
      </I18nProvider>,
    ),
  );
}

describe("运行期日志列表顺序", () => {
  it("倒序展示，最新记录排在最上", async () => {
    await render();
    const rows = Array.from(container.querySelectorAll("[data-log-row]"));
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain(failed.target);
    expect(rows[1].textContent).toContain(newer.target);
    expect(rows[2].textContent).toContain(older.target);
  });

  it("筛选失败记录后仍保持倒序", async () => {
    useActivityViewStore.setState({ filter: "failed" });
    await render();
    const rows = Array.from(container.querySelectorAll("[data-log-row]"));
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain(failed.target);
  });
});
