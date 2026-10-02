import { expect, it } from "vitest";
import { ALL_CATEGORIES, filterVaultEntries } from "./vault-utils";
import type { VaultEntry } from "~/types";
const entries: VaultEntry[] = [
  {
    id: "a",
    title: "Work",
    username: "USER@example.com",
    category: "工作",
    notes: "文档",
    password: "hidden-secret",
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "b",
    title: "个人",
    url: "https://example.invalid",
    category: "个人",
    createdAt: 0,
    updatedAt: 0,
  },
];
it("标题/账号/网址/备注搜索忽略大小写和两侧空白", () => {
  expect(
    filterVaultEntries(entries, " user@ ", ALL_CATEGORIES).map((e) => e.id),
  ).toEqual(["a"]);
  expect(
    filterVaultEntries(entries, "文档", ALL_CATEGORIES).map((e) => e.id),
  ).toEqual(["a"]);
  expect(
    filterVaultEntries(entries, "example.invalid", ALL_CATEGORIES).map(
      (e) => e.id,
    ),
  ).toEqual(["b"]);
});
it("分类与搜索同时匹配，清空筛选保留原有顺序", () => {
  expect(filterVaultEntries(entries, "Work", "个人")).toEqual([]);
  expect(filterVaultEntries(entries, "", ALL_CATEGORIES)).toEqual(entries);
});
it("搜索不使用密码内容", () => {
  expect(filterVaultEntries(entries, "hidden-secret", ALL_CATEGORIES)).toEqual(
    [],
  );
});
