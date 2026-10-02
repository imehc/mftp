import { beforeEach, expect, it } from "vitest";
import { i18n } from "@lingui/core";
import { filterLogs, logDetail } from "./log-utils";
import type { ActivityLog } from "~/types";
const now = 10 * 24 * 60 * 60 * 1000;
const row: ActivityLog = {
  id: "a",
  createdAt: now,
  source: "sftp",
  requestType: "upload",
  ip: "README.md",
  result: "failed",
  detail: "transfer",
  error: {
    kind: "external",
    code: "io:operation",
    message: "Connection lost",
    args: {},
  },
};
beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});
it("搜索包括本地化来源与完整错误，忽略大小写和两端空白", () => {
  expect(filterLogs([row], " connection LOST ", "all", {}, now)).toEqual([row]);
  expect(filterLogs([row], "文件", "all", { sftp: "文件" }, now)).toEqual([
    row,
  ]);
  expect(filterLogs([row], "none", "all", {}, now)).toEqual([]);
});
it("历史错误去重但不会隐藏缺少 detail 的错误", () => {
  const legacy = {
    ...row,
    detail: "Original error",
    error: {
      kind: "external" as const,
      code: "legacy:raw",
      message: "Original error",
      args: {},
    },
  };
  expect(logDetail(legacy)).toBe("Original error");
  expect(logDetail({ ...legacy, detail: null })).toBe("Original error");
});
it("近七天保留边界日志且不影响全部时间", () => {
  const boundary = { ...row, createdAt: now - 7 * 86400000 };
  const old = { ...row, id: "old", createdAt: boundary.createdAt - 1 };
  expect(filterLogs([boundary, old], "", "7d", {}, now)).toEqual([boundary]);
  expect(filterLogs([boundary, old], "", "all", {}, now)).toEqual([
    boundary,
    old,
  ]);
});
