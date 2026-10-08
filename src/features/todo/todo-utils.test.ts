import { afterEach, describe, expect, it, vi } from "vitest";

import type { TodoItem } from "~/types";

import {
  buildTodoListRows,
  formatTodoDate,
  formatTodoTimestamp,
  localTimeKey,
  matchesTodoQuery,
  plannedDate,
  plannedTimestamp,
  sortTodoItems,
  todoView,
} from "./todo-utils";

function item(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: "task",
    title: "Task",
    category: null,
    notes: null,
    dueDate: null,
    dueAt: null,
    completed: false,
    completedAt: null,
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("待办计划时间", () => {
  it("按计划日期合并分组，组内时刻早于完成状态和更新时间排序", () => {
    vi.stubEnv("TZ", "Asia/Shanghai");
    const at = (date: string, time: string) => plannedTimestamp(date, time)!;
    const tasks = [
      item({
        id: "afternoon",
        dueAt: at("2026-10-01", "15:30"),
        updatedAt: 999,
      }),
      item({ id: "next-day", dueAt: at("2026-10-02", "08:00") }),
      item({
        id: "morning-done",
        dueAt: at("2026-10-01", "09:00"),
        completed: true,
      }),
      item({ id: "date-only", dueDate: "2026-10-01" }),
      item({ id: "unscheduled" }),
    ];
    const rows = buildTodoListRows(tasks);
    expect(rows.filter((row) => row.kind === "header")).toEqual([
      {
        kind: "header",
        key: "header-2026-10-01",
        dueDate: "2026-10-01",
        count: 3,
      },
      {
        kind: "header",
        key: "header-2026-10-02",
        dueDate: "2026-10-02",
        count: 1,
      },
      { kind: "header", key: "header-unscheduled", dueDate: null, count: 1 },
    ]);
    expect(
      rows.flatMap((row) => (row.kind === "item" ? [row.item.id] : [])),
    ).toEqual([
      "date-only",
      "morning-done",
      "afternoon",
      "next-day",
      "unscheduled",
    ]);
  });

  it("紧凑时间省略当年年份，跨年时间和日期型计划保留年份", () => {
    vi.stubEnv("TZ", "Asia/Shanghai");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00"));
    const value = plannedTimestamp("2026-10-01", "09:35")!;
    expect(formatTodoTimestamp(value, "zh-CN", true)).toBe("10/01 09:35");
    expect(formatTodoTimestamp(value, "zh-CN")).toBe("2026/10/01 09:35");
    expect(formatTodoDate("2026-10-02", "zh-CN", true)).toBe("10/02");
    expect(formatTodoDate("2027-10-02", "zh-CN", true)).toBe("2027/10/02");
    expect(
      formatTodoTimestamp(
        plannedTimestamp("2027-10-01", "09:35")!,
        "zh-CN",
        true,
      ),
    ).toBe("2027/10/01 09:35");
  });

  it("以本地分钟输入并存为绝对时刻", () => {
    vi.stubEnv("TZ", "Asia/Shanghai");
    const value = plannedTimestamp("2026-10-01", "09:35");
    expect(value).toBe(Date.UTC(2026, 9, 1, 1, 35));
    expect(localTimeKey(new Date(value!))).toBe("09:35");
  });

  it("拒绝无效日期、无效时刻和缺少日期", () => {
    for (const [date, time] of [
      ["2026-02-29", "09:00"],
      ["2026-10-01", "24:00"],
      ["", "09:00"],
      ["2026-10-01", "09:00:30"],
    ]) {
      expect(plannedTimestamp(date, time)).toBeNull();
    }
  });

  it("不把夏令时跳过的时刻悄悄移到下一小时", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(plannedTimestamp("2026-03-08", "02:30")).toBeNull();
  });

  it("到计划分钟即逾期，完成状态优先", () => {
    const dueAt = Date.UTC(2026, 9, 1, 9, 35);
    expect(todoView(item({ dueAt }), dueAt - 1)).toBe("active");
    expect(todoView(item({ dueAt }), dueAt)).toBe("overdue");
    expect(todoView(item({ dueAt, completed: true }), dueAt + 1)).toBe(
      "completed",
    );
  });

  it("历史日期型待办到次日才逾期", () => {
    vi.stubEnv("TZ", "Asia/Shanghai");
    const task = item({ dueDate: "2026-10-01" });
    expect(todoView(task, new Date("2026-10-01T23:59:59").getTime())).toBe(
      "active",
    );
    expect(todoView(task, new Date("2026-10-02T00:00:00").getTime())).toBe(
      "overdue",
    );
  });

  it("切换时区后按实际本地日期分组，同日按计划时间排序", () => {
    vi.stubEnv("TZ", "America/New_York");
    const early = item({
      id: "early",
      dueDate: "2026-10-02",
      dueAt: Date.UTC(2026, 9, 2, 1),
    });
    const late = item({
      id: "late",
      dueDate: "2026-10-02",
      dueAt: Date.UTC(2026, 9, 2, 2),
    });
    expect(plannedDate(early)).toBe("2026-10-01");
    expect(sortTodoItems([late, early]).map((row) => row.id)).toEqual([
      "early",
      "late",
    ]);
    const rows = buildTodoListRows([late, early]);
    expect(rows[0]).toMatchObject({
      kind: "header",
      dueDate: "2026-10-01",
      count: 2,
    });
  });
});

it("搜索匹配标题、备注和分类，忽略首尾空白与大小写", () => {
  const task = item({
    title: "Review UI",
    notes: "检查间距",
    category: "工作",
  });
  expect(matchesTodoQuery(task, " ui ")).toBe(true);
  expect(matchesTodoQuery(task, "间距")).toBe(true);
  expect(matchesTodoQuery(task, "工作")).toBe(true);
  expect(matchesTodoQuery(item(), " ")).toBe(true);
  expect(matchesTodoQuery(item(), "missing")).toBe(false);
});
