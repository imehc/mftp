import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markRecentPath, useRecentPathsStore } from "./recent-paths";

beforeEach(() => {
  vi.useFakeTimers();
  useRecentPathsStore.setState({ marks: new Map() });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("上传落地后的行高亮", () => {
  it("标记后立即命中", () => {
    markRecentPath("/home/a.zip");
    expect(useRecentPathsStore.getState().marks.has("/home/a.zip")).toBe(true);
  });

  it("保留时长结束后自动清除", () => {
    markRecentPath("/home/a.zip");
    vi.advanceTimersByTime(2000);
    expect(useRecentPathsStore.getState().marks.has("/home/a.zip")).toBe(false);
  });

  it("同一路径重复上传时不会被旧定时器提前清除", () => {
    markRecentPath("/home/a.zip");
    vi.advanceTimersByTime(1000);
    markRecentPath("/home/a.zip");
    // 第一次标记的定时器到期，但不能清掉第二次的标记。
    vi.advanceTimersByTime(1000);
    expect(useRecentPathsStore.getState().marks.has("/home/a.zip")).toBe(true);
    vi.advanceTimersByTime(900);
    expect(useRecentPathsStore.getState().marks.has("/home/a.zip")).toBe(false);
  });
});
