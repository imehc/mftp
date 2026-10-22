// @vitest-environment happy-dom

import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiagnosticOperation, DiagnosticSnapshot } from "~/bindings";

const session = vi.hoisted(() => ({
  publish: null as ((snapshot: DiagnosticSnapshot) => void) | null,
  open: vi.fn(),
  close: vi.fn(),
  refresh: vi.fn(),
  clear: vi.fn(async () => {}),
}));

vi.mock("~/features/connection-diagnostics/execution-log-session", () => ({
  openExecutionLogSession: (
    publish: (snapshot: DiagnosticSnapshot) => void,
  ) => {
    session.open();
    session.publish = publish;
    return { close: session.close, refresh: session.refresh };
  },
}));
vi.mock("~/lib/ipc", () => ({ diagnosticsClear: session.clear }));

import { ActivityProvider, useActivityExecutionLogs } from "./ActivityProvider";

const operation: DiagnosticOperation = {
  id: "operation-1",
  source: "http",
  action: "get",
  target: "https://example.test/collections",
  correlationId: null,
  trace: null,
  progress: null,
  discardedDetails: 0,
  metadataTruncated: false,
  redacted: false,
  startedAt: 1,
  elapsedMs: 0,
  status: "running",
  phase: "sending",
  details: [],
  error: null,
};
let root: Root;
let container: HTMLDivElement;
let clearLogs: ReturnType<typeof useActivityExecutionLogs>["clear"];

function Probe({ pathname }: { pathname: string }) {
  const logs = useActivityExecutionLogs();
  useEffect(() => {
    clearLogs = logs.clear;
  }, [logs.clear]);
  return (
    <div data-pathname={pathname}>
      <output data-operations>
        {logs.operations.map((item) => `${item.id}:${item.status}`).join(",")}
      </output>
      <output data-discarded>{logs.discarded}</output>
      <output data-loading>{String(logs.loading)}</output>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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

async function renderPath(pathname = "/") {
  await act(async () =>
    root.render(
      <StrictMode>
        <ActivityProvider>
          <Probe pathname={pathname} />
        </ActivityProvider>
      </StrictMode>,
    ),
  );
}

async function publish(status: DiagnosticOperation["status"] = "running") {
  await act(async () =>
    session.publish?.({
      cursor: 2,
      discarded: 3,
      operations: [{ ...operation, status }],
    }),
  );
}

describe("应用级日志生命周期", () => {
  it.each(["/", "/about", "/logs"])(
    "离开活动页到 %s 后返回保留唯一订阅和记录",
    async (pathname) => {
      await renderPath("/activity");
      await publish();
      const opened = session.open.mock.calls.length;
      const closed = session.close.mock.calls.length;
      await renderPath(pathname);
      await publish("passed");
      await renderPath("/activity");
      expect(container.querySelector("[data-operations]")?.textContent).toBe(
        "operation-1:passed",
      );
      expect(session.open).toHaveBeenCalledTimes(opened);
      expect(session.close).toHaveBeenCalledTimes(closed);
      expect(opened - closed).toBe(1);
      expect(session.clear).not.toHaveBeenCalled();
    },
  );

  it("首次快照完成前保持加载状态", async () => {
    await renderPath();
    expect(container.querySelector("[data-loading]")?.textContent).toBe("true");
    await publish();
    expect(container.querySelector("[data-loading]")?.textContent).toBe(
      "false",
    );
  });

  it("手动清空后按权威快照更新，不覆盖清空期间产生的新记录", async () => {
    await renderPath();
    await publish();
    await act(async () => clearLogs());
    expect(session.clear).toHaveBeenCalledTimes(1);
    expect(session.refresh).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-operations]")?.textContent).toBe(
      "operation-1:running",
    );
    await act(async () =>
      session.publish?.({
        cursor: 3,
        discarded: 0,
        operations: [{ ...operation, id: "new-operation" }],
      }),
    );
    expect(container.querySelector("[data-operations]")?.textContent).toBe(
      "new-operation:running",
    );
  });

  it("清空失败保留投影并向操作方返回错误", async () => {
    await renderPath();
    await publish();
    const failure = {
      kind: "external",
      code: "test:clear",
      message: "Clear failed",
      args: {},
    };
    session.clear.mockRejectedValueOnce(failure);
    await expect(clearLogs()).rejects.toEqual(failure);
    expect(session.refresh).not.toHaveBeenCalled();
    expect(container.querySelector("[data-operations]")?.textContent).toBe(
      "operation-1:running",
    );
  });

  it("外壳卸载只关闭订阅，不触发清空", async () => {
    await renderPath();
    await act(async () => root.render(null));
    expect(session.close.mock.calls.length).toBe(
      session.open.mock.calls.length,
    );
    expect(session.clear).not.toHaveBeenCalled();
  });
});
