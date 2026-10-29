// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import QueryProvider from "~/app/QueryProvider";
import type { DiagnosticOperation, LogPage } from "~/bindings";
import { logPage } from "~/features/logs/__fixtures__/page";
import { logDetailQuery } from "~/features/logs/queries";
import { createAppQueryClient } from "~/lib/query-client";

const port = vi.hoisted(() => ({
  read: vi.fn(),
  clear: vi.fn(),
  unlisten: vi.fn(),
  changed: null as (() => void) | null,
}));
vi.mock("~/lib/ipc", () => ({
  logsPage: port.read,
  diagnosticsClear: port.clear,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, changed: () => void) => {
    port.changed = changed;
    return port.unlisten;
  }),
}));
import { LOG_FALLBACK_MS, useExecutionLogs } from "./use-execution-logs";

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
const initial = logPage([operation], [], 3);
const failure = {
  kind: "external",
  code: "diagnostics:test",
  message: "Snapshot unavailable",
  args: {},
};
let root: Root;
let container: HTMLDivElement;
let client: ReturnType<typeof createAppQueryClient>;
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

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  port.read.mockResolvedValue(initial);
  port.clear.mockResolvedValue(undefined);
  port.changed = null;
  client = createAppQueryClient();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryProvider client={client}>
        <Probe />
      </QueryProvider>,
    ),
  );
  await flush();
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("共享日志查询的事件与清空", () => {
  it("读取失败保留记录和结构化错误，恢复后解除错误", async () => {
    port.read.mockRejectedValueOnce(failure);
    await act(async () => port.changed?.());
    await flush();
    expect(logs.error).toEqual(failure);
    expect(logs.operations).toEqual([operation]);
    await act(async () => port.changed?.());
    await flush();
    expect(logs.error).toBeNull();
    expect(logs.operations).toEqual([operation]);
    expect(logs.loading).toBe(false);
    expect(port.read.mock.calls).toEqual([
      [undefined, 500],
      [undefined, 500],
      [undefined, 500],
    ]);
  });

  it("高频推送等待在途读取结束并只补读一次", async () => {
    const reading = deferred<LogPage>();
    port.read.mockReturnValueOnce(reading.promise);
    await act(async () => port.changed?.());
    await act(async () => {
      port.changed?.();
      port.changed?.();
      port.changed?.();
    });
    expect(port.read).toHaveBeenCalledTimes(2);
    await act(async () => reading.resolve(initial));
    await flush();
    expect(port.read).toHaveBeenCalledTimes(3);
  });

  it("事件持续到达时推迟兜底轮询，事件丢失后自动补读", async () => {
    await act(async () => vi.advanceTimersByTimeAsync(LOG_FALLBACK_MS - 100));
    expect(port.read).toHaveBeenCalledOnce();
    await act(async () => port.changed?.());
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(port.read).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(LOG_FALLBACK_MS));
    expect(port.read).toHaveBeenCalledTimes(3);
  });

  it("清空后拒绝迟到的旧摘要和详情，保留清空后新记录", async () => {
    const oldRead = deferred<LogPage>();
    const freshRead = deferred<LogPage>();
    const oldDetail = deferred<DiagnosticOperation>();
    const detail = client
      .query({
        ...logDetailQuery(operation.id),
        queryFn: () => oldDetail.promise,
      })
      .catch(() => undefined);
    port.read
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(freshRead.promise);
    await act(async () => port.changed?.());
    await act(async () => logs.clear());
    expect(port.clear).toHaveBeenCalledOnce();
    await act(async () => {
      oldRead.resolve(initial);
      oldDetail.resolve(operation);
    });
    const fresh = { ...operation, id: "runtime-after-clear" };
    await act(async () => freshRead.resolve(logPage([fresh])));
    await detail;
    await flush();
    expect(logs.operations).toEqual([fresh]);
    expect(logs.discarded).toBe(0);
    expect(
      client.getQueryData(logDetailQuery(operation.id).queryKey),
    ).toBeUndefined();
  });

  it("清空后的空权威页释放旧投影", async () => {
    port.read.mockResolvedValue(logPage());
    await act(async () => logs.clear());
    await flush();
    expect(logs.operations).toEqual([]);
    expect(logs.discarded).toBe(0);
    await act(async () => port.changed?.());
    await flush();
    expect(logs.operations).toEqual([]);
  });

  it("清空失败返回原错误且不自动重放或伪装为空日志", async () => {
    port.clear.mockRejectedValueOnce(failure);
    await expect(logs.clear()).rejects.toEqual(failure);
    expect(port.clear).toHaveBeenCalledOnce();
    expect(port.read).toHaveBeenCalledOnce();
    expect(logs.operations).toEqual([operation]);
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
      await vi.advanceTimersByTimeAsync(LOG_FALLBACK_MS * 2);
    });
    expect(port.unlisten).toHaveBeenCalledOnce();
    expect(port.read).toHaveBeenCalledOnce();
    expect(port.clear).toHaveBeenCalledOnce();
  });
});
