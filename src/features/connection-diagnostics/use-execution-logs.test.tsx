// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiagnosticOperation, DiagnosticSnapshot } from "~/bindings";

const port = vi.hoisted(() => ({
  snapshot: vi.fn(),
  clear: vi.fn(),
  unlisten: vi.fn(),
  changed: null as (() => void) | null,
}));

vi.mock("~/lib/ipc", () => ({
  diagnosticsSnapshot: port.snapshot,
  diagnosticsClear: port.clear,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, changed: () => void) => {
    port.changed = changed;
    return port.unlisten;
  }),
}));

import { FALLBACK_POLL_MS } from "./execution-log-session";
import { useExecutionLogs } from "./use-execution-logs";

const operation: DiagnosticOperation = {
  id: "runtime-1",
  source: "http",
  action: "GET",
  target: "https://example.test/",
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
const initial: DiagnosticSnapshot = {
  cursor: 1,
  discarded: 3,
  operations: [operation],
};
const failure = {
  kind: "external",
  code: "diagnostics:test",
  message: "Snapshot unavailable",
  args: {},
};
let root: Root;
let container: HTMLDivElement;
let logs: ReturnType<typeof useExecutionLogs>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Probe() {
  const value = useExecutionLogs();
  useEffect(() => {
    logs = value;
  }, [value]);
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  port.snapshot.mockResolvedValue(initial);
  port.clear.mockResolvedValue(undefined);
  port.changed = null;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Probe />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("运行期日志的权威快照与清空", () => {
  it("读取失败保留记录和结构化错误，未变化快照恢复后仅解除错误", async () => {
    port.snapshot.mockRejectedValueOnce(failure);
    await act(async () => port.changed?.());
    expect(logs.error).toEqual(failure);
    expect(logs.operations).toEqual(initial.operations);
    port.snapshot.mockResolvedValueOnce({ ...initial, operations: null });
    await act(async () => port.changed?.());
    expect(logs.error).toBeNull();
    expect(logs.operations).toEqual(initial.operations);
    expect(logs.loading).toBe(false);
    expect(port.snapshot.mock.calls).toEqual([[0], [1], [1]]);
  });

  it("清空等待在途读取补读，保留清空后新记录而不是本地置空", async () => {
    const oldRead = deferred<DiagnosticSnapshot>();
    const freshRead = deferred<DiagnosticSnapshot>();
    port.snapshot
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(freshRead.promise);
    await act(async () => port.changed?.());
    await act(async () => logs.clear());
    expect(port.clear).toHaveBeenCalledOnce();
    expect(port.snapshot).toHaveBeenCalledTimes(2);
    expect(logs.operations).toEqual(initial.operations);
    await act(async () => oldRead.resolve({ ...initial, operations: null }));
    expect(port.snapshot).toHaveBeenCalledTimes(3);
    const fresh = { ...operation, id: "runtime-after-clear" };
    await act(async () =>
      freshRead.resolve({ cursor: 2, discarded: 0, operations: [fresh] }),
    );
    expect(logs.operations).toEqual([fresh]);
    expect(logs.discarded).toBe(0);
  });

  it("清空后的空权威快照释放旧投影并推进游标", async () => {
    port.snapshot.mockResolvedValueOnce({
      cursor: 2,
      discarded: 0,
      operations: [],
    });
    await act(async () => logs.clear());
    expect(logs.operations).toEqual([]);
    expect(logs.discarded).toBe(0);
    port.snapshot.mockResolvedValueOnce({
      cursor: 2,
      discarded: 0,
      operations: null,
    });
    await act(async () => port.changed?.());
    expect(port.snapshot.mock.calls).toEqual([[0], [1], [2]]);
    expect(logs.operations).toEqual([]);
  });

  it("清空失败返回原错误且不自动重放或伪装为空日志", async () => {
    port.clear.mockRejectedValueOnce(failure);
    await expect(logs.clear()).rejects.toEqual(failure);
    expect(port.clear).toHaveBeenCalledOnce();
    expect(port.snapshot).toHaveBeenCalledOnce();
    expect(logs.operations).toEqual(initial.operations);
  });

  it("清空期间卸载后不重建订阅、不读取和重放写操作", async () => {
    const clearing = deferred<void>();
    port.clear.mockReturnValueOnce(clearing.promise);
    const task = logs.clear();
    await act(async () => root.render(null));
    await act(async () => {
      clearing.resolve();
      await task;
      port.changed?.();
      await vi.advanceTimersByTimeAsync(FALLBACK_POLL_MS * 2);
    });
    expect(port.unlisten).toHaveBeenCalledOnce();
    expect(port.snapshot).toHaveBeenCalledOnce();
    expect(port.clear).toHaveBeenCalledOnce();
  });
});
