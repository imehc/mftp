import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppError, RsyncCapabilities } from "~/types";

import {
  forgetRsyncCapabilities,
  loadRsyncCapabilities,
  useRsyncCapabilityStore,
} from "./capability-store";

const ipcMock = vi.hoisted(() => ({ rsyncCapabilities: vi.fn() }));

vi.mock("~/lib/ipc", () => ({
  rsyncCapabilities: ipcMock.rsyncCapabilities,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function available(version = "3.2.7"): RsyncCapabilities {
  return {
    local: { status: "available", version, protocol: 31 },
    remote: { status: "available", version, protocol: 31 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useRsyncCapabilityStore.setState({ entries: {} });
});

describe("rsync 能力缓存", () => {
  it("并发读取共用一次探测", async () => {
    const pending = deferred<RsyncCapabilities>();
    ipcMock.rsyncCapabilities.mockReturnValueOnce(pending.promise);
    const first = loadRsyncCapabilities("dedupe");
    const second = loadRsyncCapabilities("dedupe");
    expect(ipcMock.rsyncCapabilities).toHaveBeenCalledTimes(1);
    pending.resolve(available());
    await expect(first).resolves.toEqual(available());
    await expect(second).resolves.toEqual(available());
    expect(useRsyncCapabilityStore.getState().entries.dedupe?.loading).toBe(
      false,
    );
  });

  it("刷新请求取代在途探测，迟到结果不覆盖新状态", async () => {
    const stale = deferred<RsyncCapabilities>();
    const fresh = deferred<RsyncCapabilities>();
    ipcMock.rsyncCapabilities
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const slow = loadRsyncCapabilities("refresh");
    const refresh = loadRsyncCapabilities("refresh", true);
    expect(ipcMock.rsyncCapabilities).toHaveBeenLastCalledWith("refresh", true);
    fresh.resolve(available("3.5.1"));
    await refresh;
    stale.resolve(available("3.0.0"));
    await slow;
    expect(
      useRsyncCapabilityStore.getState().entries.refresh?.capabilities?.local
        .version,
    ).toBe("3.5.1");
  });

  it("会话关闭后丢弃迟到结果并释放缓存", async () => {
    const pending = deferred<RsyncCapabilities>();
    ipcMock.rsyncCapabilities.mockReturnValueOnce(pending.promise);
    const request = loadRsyncCapabilities("forget");
    forgetRsyncCapabilities("forget");
    pending.resolve(available());
    await request;
    expect(useRsyncCapabilityStore.getState().entries.forget).toBeUndefined();
  });

  it("探测错误保存完整协议并结束加载状态", async () => {
    const error: AppError = {
      kind: "custom",
      code: "ssh:session_not_found",
      message: "SSH session is not available",
      args: {},
    };
    ipcMock.rsyncCapabilities.mockRejectedValueOnce(error);
    await expect(loadRsyncCapabilities("error")).resolves.toBeNull();
    expect(useRsyncCapabilityStore.getState().entries.error).toMatchObject({
      loading: false,
      error,
    });
  });

  it("已有能力结果时普通读取不再探测", async () => {
    ipcMock.rsyncCapabilities.mockResolvedValueOnce(available());
    await loadRsyncCapabilities("cache");
    await loadRsyncCapabilities("cache");
    expect(ipcMock.rsyncCapabilities).toHaveBeenCalledTimes(1);
  });
});
