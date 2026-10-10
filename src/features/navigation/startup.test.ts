import { describe, expect, it, vi } from "vitest";

vi.mock("~/features/home/entries", () => ({
  getToolEntry: (route: string) =>
    route === "crypto" ? { link: { to: "/tools/crypto" } } : undefined,
}));

import { startupEntry } from "./startup";

const input = {
  mobile: false,
  pathname: "/",
  search: "",
  restore: true,
  lastTool: "crypto",
};

describe("启动恢复决策", () => {
  it("开启时恢复已有工具，关闭时保留首页", () => {
    expect(startupEntry(input)?.link.to).toBe("/tools/crypto");
    expect(startupEntry({ ...input, restore: false })).toBeUndefined();
  });

  it("显式路径、分类链接和移动端不被恢复覆盖", () => {
    expect(startupEntry({ ...input, pathname: "/settings" })).toBeUndefined();
    expect(
      startupEntry({ ...input, search: "?category=games" }),
    ).toBeUndefined();
    expect(startupEntry({ ...input, mobile: true })).toBeUndefined();
  });

  it("没有记录、失效记录和不可用工具均留在首页", () => {
    for (const lastTool of [null, "removed-tool", "bt"]) {
      expect(startupEntry({ ...input, lastTool })).toBeUndefined();
    }
  });
});
