import { i18n } from "@lingui/core";
import { afterEach, beforeEach, expect, it } from "vitest";

import { messages as enMessages } from "~/locales/en/messages";
import type { ActivityLog } from "~/types";

import { logAction, logObject } from "./log-labels";
import { filterLogs } from "./log-utils";

const id = "12345678-abcd-4321-abcd-123456789abc";
const log: ActivityLog = {
  id: "log",
  createdAt: 0,
  source: "hosts",
  requestType: "delete",
  ip: id,
  result: "success",
};

beforeEach(() => {
  i18n.load("zh-CN", {});
  i18n.activate("zh-CN");
});

afterEach(() => {
  i18n.activate("zh-CN");
});

it("相同操作代码按来源显示不同含义", () => {
  expect(logAction(log)).toBe("删除主机");
  expect(logAction({ ...log, source: "todo" })).toBe("删除待办");
  expect(logAction({ ...log, source: "sftp" })).toBe("删除文件");
});

it("缺少名称的对象显示类型与短标识且保留原始日志", () => {
  expect(logObject(log)).toBe("主机 · 12345678…");
  expect(log.ip).toBe(id);
  expect(logObject({ ...log, source: "bt", ip: "a".repeat(40) })).toBe(
    "BT 下载任务 · aaaaaaaa…",
  );
  expect(logObject({ ...log, source: "data", ip: "" })).toBe("应用数据");
});

it("名称、路径与网络地址不会按标识截断", () => {
  expect(
    logObject({
      ...log,
      source: "ssh",
      requestType: "connect",
      ip: "192.168.1.10",
      detail: "开发服务器",
    }),
  ).toBe("开发服务器 · 192.168.1.10");
  const path = "/home/user/archive/1234567890abcdef.txt";
  expect(logObject({ ...log, source: "sftp", detail: path })).toBe(path);
  expect(
    logObject({
      ...log,
      source: "lan",
      requestType: "download",
      ip: "192.168.1.10",
    }),
  ).toBe("访问设备 · 192.168.1.10");
});

it("旧版错误诊断不会冒充文件或主机名称", () => {
  const failed: ActivityLog = {
    ...log,
    source: "sftp",
    result: "failed",
    detail: "Connection lost",
    error: {
      kind: "external",
      code: "legacy:raw",
      message: "Connection lost",
      args: {},
    },
  };
  expect(logObject(failed)).toBe("SFTP 会话 · 12345678…");
  expect(logObject({ ...failed, error: null })).toBe("SFTP 会话 · 12345678…");
  expect(
    logObject({
      ...failed,
      detail: "/tmp/report.txt",
      error: { ...failed.error!, code: "io:operation" },
    }),
  ).toBe("/tmp/report.txt");
});

it("已知资源代码显示名称且未知值保留", () => {
  expect(logObject({ ...log, source: "poetry", ip: "annotations" })).toBe(
    "诗词注释库",
  );
  expect(
    logObject({
      ...log,
      source: "games",
      requestType: "create_room",
      ip: "gomoku/online-v2",
    }),
  ).toBe("五子棋房间");
  expect(logAction({ ...log, requestType: "future_action" })).toBe(
    "future_action",
  );
  expect(logAction({ ...log, source: "future" })).toBe("delete");
  expect(logObject({ ...log, source: "future" })).toBe(id);
  expect(logObject({ ...log, source: "future", ip: "" })).toBe("—");
});

it("搜索同时匹配可读操作、对象类型和完整原值", () => {
  expect(filterLogs([log], "删除主机", "all", {})).toEqual([log]);
  expect(filterLogs([log], "主机 · 12345678", "all", {})).toEqual([log]);
  expect(filterLogs([log], id, "all", {})).toEqual([log]);
  expect(filterLogs([log], "delete", "all", {})).toEqual([log]);
});

it("语言切换后操作、对象与搜索使用当前语言", () => {
  i18n.load("en", enMessages);
  i18n.activate("en");
  expect(logAction(log)).toBe("Delete Host");
  expect(logObject(log)).toBe("Host · 12345678…");
  expect(filterLogs([log], "delete host", "all", {})).toEqual([log]);
  i18n.activate("zh-CN");
  expect(logAction(log)).toBe("删除主机");
  expect(logObject(log)).toBe("主机 · 12345678…");
});
