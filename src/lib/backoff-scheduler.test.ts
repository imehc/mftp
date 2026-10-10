import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBackoffScheduler } from "./backoff-scheduler";

beforeEach(() => vi.useFakeTimers());

afterEach(() => vi.useRealTimers());

describe("重连退避调度", () => {
  it("指数递增至上限，单次调度不会自动循环", () => {
    const retry = vi.fn();
    const scheduler = createBackoffScheduler(retry, {
      baseMs: 1000,
      maxMs: 30000,
    });
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      retry.mockClear();
      scheduler.schedule();
      vi.advanceTimersByTime(delay - 1);
      expect(retry).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(retry).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("重复调度替换旧定时器，重置取消等待并恢复初始延迟", () => {
    const retry = vi.fn();
    const scheduler = createBackoffScheduler(retry, {
      baseMs: 1000,
      maxMs: 30000,
    });
    scheduler.schedule();
    scheduler.schedule();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(retry).not.toHaveBeenCalled();
    scheduler.reset();
    expect(vi.getTimerCount()).toBe(0);
    scheduler.schedule();
    vi.advanceTimersByTime(1000);
    expect(retry).toHaveBeenCalledOnce();
  });

  it("停止不可由迟到调度或重置复活，各实例独立", () => {
    const retry = vi.fn();
    const stopped = createBackoffScheduler(retry, {
      baseMs: 1000,
      maxMs: 30000,
    });
    stopped.schedule();
    stopped.stop();
    stopped.stop();
    stopped.reset();
    stopped.schedule();
    vi.runAllTimers();
    expect(retry).not.toHaveBeenCalled();
    const next = createBackoffScheduler(retry, { baseMs: 1000, maxMs: 30000 });
    next.schedule();
    vi.advanceTimersByTime(1000);
    expect(retry).toHaveBeenCalledOnce();
  });
});
