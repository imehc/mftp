import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiagnosticSnapshot } from "~/bindings";
import type { Subscription } from "~/lib/event-subscription";

import {
  FALLBACK_POLL_MS,
  openExecutionLogSession,
} from "./execution-log-session";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const snapshot: DiagnosticSnapshot = {
  cursor: 1,
  discarded: 0,
  operations: [],
};

/** 受测端口：手动触发推送，便于断言事件驱动的读取次数。 */
function portWith(
  snapshotImpl: (after: number) => Promise<DiagnosticSnapshot>,
) {
  let push: () => void = () => undefined;
  const subscription: Subscription = {
    ready: Promise.resolve(),
    dispose: vi.fn(),
  };
  return {
    port: {
      snapshot: vi.fn(snapshotImpl),
      subscribe: vi.fn((onChange: () => void) => {
        push = onChange;
        return subscription;
      }),
    },
    push: () => push(),
    subscription,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("应用级执行日志订阅", () => {
  it("挂载即读取一次，随后由事件推送驱动", async () => {
    vi.useFakeTimers();
    const { port, push } = portWith(async () => snapshot);
    const publish = vi.fn();
    const session = openExecutionLogSession(publish, vi.fn(), port);
    await vi.advanceTimersByTimeAsync(0);
    expect(port.snapshot).toHaveBeenCalledTimes(1);
    push();
    await vi.advanceTimersByTimeAsync(0);
    expect(port.snapshot).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(2);
    session.close();
  });

  it("高频推送合并为一次补读，且不产生并发读取", async () => {
    vi.useFakeTimers();
    const reading = deferred<DiagnosticSnapshot>();
    const { port, push } = portWith(() => reading.promise);
    const session = openExecutionLogSession(vi.fn(), vi.fn(), port);
    await vi.advanceTimersByTimeAsync(0);
    push();
    push();
    push();
    expect(port.snapshot).toHaveBeenCalledTimes(1);
    reading.resolve(snapshot);
    await vi.advanceTimersByTimeAsync(0);
    // 三次推送只补读一次。
    expect(port.snapshot).toHaveBeenCalledTimes(2);
    session.close();
  });

  it("事件全部丢失时仍有兜底轮询", async () => {
    vi.useFakeTimers();
    const { port } = portWith(async () => snapshot);
    const session = openExecutionLogSession(vi.fn(), vi.fn(), port);
    await vi.advanceTimersByTimeAsync(0);
    expect(port.snapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_MS);
    expect(port.snapshot).toHaveBeenCalledTimes(2);
    session.close();
  });

  it("关闭后停止读取并解除订阅，迟到结果不回填", async () => {
    vi.useFakeTimers();
    const reading = deferred<DiagnosticSnapshot>();
    const { port, push, subscription } = portWith(() => reading.promise);
    const publish = vi.fn();
    const session = openExecutionLogSession(publish, vi.fn(), port);
    await vi.advanceTimersByTimeAsync(0);
    session.close();
    session.close();
    push();
    reading.resolve(snapshot);
    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_MS * 2);
    expect(publish).not.toHaveBeenCalled();
    expect(port.snapshot).toHaveBeenCalledTimes(1);
    expect(subscription.dispose).toHaveBeenCalledTimes(1);
  });

  it("按游标读取且保留结构化查询错误", async () => {
    vi.useFakeTimers();
    const failure = {
      kind: "external",
      code: "diagnostics:unavailable",
      message: "Unavailable",
      args: {},
    };
    const { port, push } = portWith(
      vi
        .fn()
        .mockResolvedValueOnce(snapshot)
        .mockRejectedValueOnce(failure)
        .mockResolvedValue({ ...snapshot, operations: null }) as never,
    );
    const onError = vi.fn();
    const session = openExecutionLogSession(vi.fn(), onError, port);
    await vi.advanceTimersByTimeAsync(0);
    push();
    await vi.advanceTimersByTimeAsync(0);
    expect(port.snapshot.mock.calls).toEqual([[0], [1]]);
    expect(onError).toHaveBeenCalledWith(failure);
    session.close();
  });
});
