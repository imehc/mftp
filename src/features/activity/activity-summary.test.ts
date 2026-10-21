import { describe, expect, it } from "vitest";

import {
  type ActivitySummaryInput,
  summarizeActivity,
} from "./activity-summary";

const idle: ActivitySummaryInput = {
  transferRunning: 0,
  transferFailed: 0,
  poetrySync: { active: false, phase: null },
  updater: { running: false, pending: false, error: false },
  latestLogStatus: null,
};

function summary(overrides: Partial<ActivitySummaryInput>) {
  return summarizeActivity({ ...idle, ...overrides });
}

describe("活动摘要", () => {
  it("失败数量优先于运行中、更新和日志状态", () => {
    const result = summary({
      transferRunning: 1,
      transferFailed: 2,
      poetrySync: { active: true, phase: "downloading" },
      updater: { running: true, pending: true, error: true },
      latestLogStatus: "running",
    });

    expect(result).toMatchObject({
      failed: 3,
      running: 3,
      updatePending: true,
      logsActive: true,
      tone: "error",
      count: 3,
    });
  });

  it("无失败时统计所有运行中任务", () => {
    const result = summary({
      transferRunning: 2,
      poetrySync: { active: true, phase: "importing" },
      updater: { running: true, pending: false, error: false },
    });

    expect(result).toMatchObject({
      failed: 0,
      running: 4,
      tone: "running",
      count: 4,
    });
  });

  it("诗词同步失败计入失败数量", () => {
    const result = summary({
      poetrySync: { active: false, phase: "error" },
    });

    expect(result).toMatchObject({
      failed: 1,
      tone: "error",
      count: 1,
    });
  });

  it("用户主动取消的同步不计为失败", () => {
    expect(
      summary({
        poetrySync: { active: false, phase: "error", cancelled: true },
      }),
    ).toMatchObject({ failed: 0, tone: null, count: null });
  });

  it("仅有可用更新时使用提示圆点而不显示数量", () => {
    const result = summary({
      updater: { running: false, pending: true, error: false },
    });

    expect(result).toMatchObject({
      updatePending: true,
      tone: "attention",
      count: null,
    });
  });

  it.each(["running", "failed", "interrupted"] as const)(
    "执行日志状态 %s 视为活动",
    (latestLogStatus) => {
      const result = summary({ latestLogStatus });

      expect(result).toMatchObject({
        logsActive: true,
        tone: "logs",
        count: null,
      });
    },
  );

  it("已完成或未验证的日志不显示活动圆点", () => {
    for (const latestLogStatus of ["passed", "unverified"] as const) {
      expect(summary({ latestLogStatus }).tone).toBeNull();
    }
  });

  it("全部空闲时不显示徽标", () => {
    expect(summary({ latestLogStatus: "passed" })).toMatchObject({
      failed: 0,
      running: 0,
      updatePending: false,
      logsActive: false,
      tone: null,
      count: null,
    });
  });
});
