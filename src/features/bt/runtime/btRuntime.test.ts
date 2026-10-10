import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  poll: vi.fn(),
  ios: false,
  setError: vi.fn(),
  refresh: vi.fn(async () => undefined),
  state: { error: null as unknown },
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("~/lib/errors", () => ({
  toIpcError: (cause: unknown) => ({ payload: cause }),
}));
vi.mock("~/lib/platform", () => ({ isIosPlatform: () => mocks.ios }));
vi.mock("~/lib/polling", () => ({ createPoller: mocks.poll }));
vi.mock("../peer-watch", () => ({ updatePeerWatch: vi.fn() }));
vi.mock("../task-events", () => ({ applyBtTaskEvent: vi.fn() }));
vi.mock("../task-sync", () => ({ syncBtTasks: vi.fn() }));
vi.mock("../tasks-store", () => ({
  refreshBtTasks: mocks.refresh,
  useBtTasksStore: {
    subscribe: () => () => undefined,
    getState: () => ({
      subscriptionError: mocks.state.error,
      setSubscriptionError: mocks.setError,
    }),
  },
}));
vi.mock("~/store/transfers", () => ({
  useTransfersStore: {
    subscribe: () => () => undefined,
    getState: () => ({ transfers: [] }),
  },
}));

import {
  acquireBtPage,
  installBtRuntime,
  retryBtSubscription,
} from "./btRuntime";

let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.listen.mockReset();
  mocks.ios = false;
  mocks.poll.mockReset();
  mocks.poll.mockImplementation(() => ({ stop: vi.fn() }));
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

describe("BT订阅重连", () => {
  it("同步与异步注册失败退避，成功后清错误，手动重试立即执行", async () => {
    const unlisten = vi.fn();
    mocks.listen
      .mockImplementationOnce(() => {
        throw new Error("sync");
      })
      .mockRejectedValueOnce(new Error("async"))
      .mockResolvedValue(unlisten);
    dispose = installBtRuntime();
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
    retryBtSubscription();
    expect(mocks.listen).toHaveBeenCalledTimes(4);
    expect(unlisten).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30000);
    expect(mocks.listen).toHaveBeenCalledTimes(4);
  });

  it("等待期间手动重连清除定时器并恢复初始退避", async () => {
    mocks.listen.mockRejectedValue(new Error("offline"));
    dispose = installBtRuntime();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.listen).toHaveBeenCalledTimes(2);
    retryBtSubscription();
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
    const oldDispose = installBtRuntime();
    oldDispose();
    dispose = installBtRuntime();
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
    dispose = installBtRuntime();
    retryBtSubscription();
    reject(new Error("stale"));
    await vi.advanceTimersByTimeAsync(60000);
    expect(mocks.setError).not.toHaveBeenCalled();
    expect(mocks.listen).toHaveBeenCalledTimes(2);
  });
});

describe("BT 页面轮询租约", () => {
  it("旧页面释放不停止重新安装后新页面的轮询", () => {
    mocks.listen.mockResolvedValue(vi.fn());
    const oldDispose = installBtRuntime();
    const oldRelease = acquireBtPage();
    const oldPoller = mocks.poll.mock.results[0].value;
    oldDispose();
    expect(oldPoller.stop).toHaveBeenCalledOnce();
    dispose = installBtRuntime();
    const release = acquireBtPage();
    const current = mocks.poll.mock.results[1].value;
    oldRelease();
    oldRelease();
    expect(current.stop).not.toHaveBeenCalled();
    release();
    expect(current.stop).toHaveBeenCalledOnce();
  });

  it("多页面只创建一个轮询，最后一个租约释放才停止", () => {
    mocks.listen.mockResolvedValue(vi.fn());
    dispose = installBtRuntime();
    const first = acquireBtPage();
    const second = acquireBtPage();
    expect(mocks.poll).toHaveBeenCalledOnce();
    const current = mocks.poll.mock.results[0].value;
    first();
    first();
    expect(current.stop).not.toHaveBeenCalled();
    second();
    expect(current.stop).toHaveBeenCalledOnce();
  });

  it("先挂载页面不会提前轮询，runtime 安装后才读取", () => {
    mocks.listen.mockResolvedValue(vi.fn());
    const release = acquireBtPage();
    expect(mocks.poll).not.toHaveBeenCalled();
    dispose = installBtRuntime();
    expect(mocks.poll).toHaveBeenCalledOnce();
    dispose();
    release();
    expect(mocks.poll).toHaveBeenCalledOnce();
  });

  it("iOS 不注册页面轮询或事件监听", () => {
    mocks.ios = true;
    dispose = installBtRuntime();
    acquireBtPage()();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
  });
});
