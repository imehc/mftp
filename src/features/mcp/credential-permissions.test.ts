import { describe, expect, it } from "vitest";

import {
  ALL_MODULES,
  changePermission,
  clientPermission,
} from "./credential-permissions";

describe("MCP 模块授权", () => {
  it("全部模块授权展示同一权限且不会隐式允许删除", () => {
    expect(
      clientPermission({
        id: "all",
        name: "test",
        createdAt: 1,
        grants: { [ALL_MODULES]: { read: true, write: true, delete: false } },
      }),
    ).toEqual({
      global: true,
      uniform: true,
      grant: { read: true, write: true, delete: false },
    });
  });

  it("旧版分模块授权不冒充全部模块权限", () => {
    expect(
      clientPermission({
        id: "old",
        name: "test",
        createdAt: 1,
        grants: {
          todo: { read: true, write: false, delete: false },
          other: { read: true, write: true, delete: false },
        },
      }),
    ).toEqual({ global: false, uniform: false, grant: undefined });
  });

  it("升级读写不自动开启删除", () => {
    expect(
      changePermission(
        { read: true, write: false, delete: false },
        "write",
        true,
      ),
    ).toEqual({ read: true, write: true, delete: false });
  });

  it("降为只读会清除编辑和删除", () => {
    expect(
      changePermission(
        { read: true, write: true, delete: true },
        "write",
        false,
      ),
    ).toEqual({ read: true, write: false, delete: false });
  });

  it("取消读取会同时清除依赖的写入和删除权限", () => {
    expect(
      changePermission(
        { read: true, write: true, delete: true },
        "read",
        false,
      ),
    ).toEqual({ read: false, write: false, delete: false });
  });

  it("删除必须单独勾选且不能绕过读取写入前提", () => {
    expect(
      changePermission(
        { read: true, write: false, delete: false },
        "delete",
        true,
      ),
    ).toEqual({ read: true, write: false, delete: false });
    expect(
      changePermission(
        { read: true, write: true, delete: false },
        "delete",
        true,
      ),
    ).toEqual({ read: true, write: true, delete: true });
  });
});
