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
  logStatuses: [],
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
      logStatuses: ["running"],
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
    (status) => {
      const result = summary({ logStatuses: [status] });

      expect(result).toMatchObject({
        logsActive: true,
        tone: status === "running" ? "running" : "error",
        count: null,
        kind: "logs",
        destination: "logs",
      });
    },
  );

  it("已完成或未验证的日志不显示活动圆点", () => {
    for (const status of ["passed", "unverified"] as const) {
      expect(summary({ logStatuses: [status] }).tone).toBeNull();
    }
  });

  it("全部空闲时不显示徽标", () => {
    expect(summary({ logStatuses: ["passed"] })).toMatchObject({
      failed: 0,
      running: 0,
      updatePending: false,
      logsActive: false,
      tone: null,
      count: null,
    });
  });

  it("较早的失败不被后续成功覆盖，优先进入日志", () => {
    expect(
      summary({ transferRunning: 1, logStatuses: ["failed", "passed"] }),
    ).toMatchObject({
      tone: "error",
      count: null,
      kind: "mixed",
      destination: "logs",
    });
  });

  it.each([
    [{ transferRunning: 1 }, "transfer"],
    [{ poetrySync: { active: true, phase: "importing" } }, "sync"],
    [{ updater: { running: false, pending: true, error: false } }, "update"],
    [{}, "idle"],
  ] as const)("单一任务类型映射为 %s 对应的图标类型 %s", (overrides, kind) => {
    expect(summary(overrides).kind).toBe(kind);
  });
});
