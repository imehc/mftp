import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  setError: vi.fn(),
  refresh: vi.fn(async () => undefined),
  state: { error: null as unknown },
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("~/lib/errors", () => ({
  toIpcError: (cause: unknown) => ({ payload: cause }),
}));
vi.mock("~/store/transfers", () => ({
  useTransfersStore: {
    getState: () => ({
      runtimeError: mocks.state.error,
      setRuntimeError: mocks.setError,
      updateProgressBatch: vi.fn(),
    }),
  },
}));

import {
  installTransferRuntime,
  retryTransferRuntime,
} from "./transferRuntime";

let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.listen.mockReset();
  mocks.setError.mockReset();
  mocks.refresh.mockClear();
  mocks.state.error = null;
  mocks.setError.mockImplementation((error) => {
    mocks.state.error = error;
  });
});

afterEach(() => {
  dispose?.();
  vi.useRealTimers();
});

describe("传输进度订阅重连", () => {
  it("同步与异步注册失败退避，成功后清错误，手动重试立即执行", async () => {
    const unlisten = vi.fn();
    mocks.listen
      .mockImplementationOnce(() => {
        throw new Error("sync");
      })
      .mockRejectedValueOnce(new Error("async"))
      .mockResolvedValue(unlisten);
    dispose = installTransferRuntime();
    expect(mocks.listen).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.listen).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.listen).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(mocks.listen).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.listen).toHaveBeenCalledTimes(3);
    expect(mocks.setError).toHaveBeenLastCalledWith(null);
    retryTransferRuntime();
    expect(mocks.listen).toHaveBeenCalledTimes(4);
    expect(unlisten).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30000);
    expect(mocks.listen).toHaveBeenCalledTimes(4);
  });

  it("等待期间手动重连清除定时器并恢复初始退避", async () => {
    mocks.listen.mockRejectedValue(new Error("offline"));
    dispose = installTransferRuntime();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.listen).toHaveBeenCalledTimes(2);
    retryTransferRuntime();
    expect(mocks.listen).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.listen).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.listen).toHaveBeenCalledTimes(4);
    dispose();
    await vi.advanceTimersByTimeAsync(60000);
    expect(mocks.listen).toHaveBeenCalledTimes(4);
  });

  it("释放后注册才完成会立即解除，旧释放句柄不影响重新安装", async () => {
    let resolve!: (unlisten: () => void) => void;
    const oldUnlisten = vi.fn();
    const newUnlisten = vi.fn();
    mocks.listen
      .mockReturnValueOnce(
        new Promise<() => void>((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValue(newUnlisten);
    const oldDispose = installTransferRuntime();
    oldDispose();
    dispose = installTransferRuntime();
    oldDispose();
    resolve(oldUnlisten);
    await vi.advanceTimersByTimeAsync(0);
    expect(oldUnlisten).toHaveBeenCalledOnce();
    expect(newUnlisten).not.toHaveBeenCalled();
    dispose();
    expect(newUnlisten).toHaveBeenCalledOnce();
  });

  it("已替换订阅的迟到失败不发布错误也不重连", async () => {
    let reject!: (cause: unknown) => void;
    mocks.listen
      .mockReturnValueOnce(
        new Promise<() => void>((_, fail) => {
          reject = fail;
        }),
      )
      .mockResolvedValue(vi.fn());
    dispose = installTransferRuntime();
    retryTransferRuntime();
    reject(new Error("stale"));
    await vi.advanceTimersByTimeAsync(60000);
    expect(mocks.setError).not.toHaveBeenCalled();
    expect(mocks.listen).toHaveBeenCalledTimes(2);
  });
});
