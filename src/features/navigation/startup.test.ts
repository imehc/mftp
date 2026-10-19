import { describe, expect, it } from "vitest";

import type { ModuleId } from "~/lib/module-metadata";

import { startupEntry, startupPages } from "./startup";

const input: Parameters<typeof startupEntry>[0] = {
  mobile: false,
  platform: "desktop",
  pathname: "/",
  search: "",
  mode: "last",
  lastPage: "crypto",
  manualPage: "library",
  visibility: {},
  hiddenCategories: [],
  showGames: true,
};

describe("启动页面决策", () => {
  it("首页、手动指定和恢复上次页面分别使用对应目标", () => {
    expect(startupEntry(input)?.link.to).toBe("/tools/crypto");
    expect(startupEntry({ ...input, mode: "manual" })?.link.to).toBe(
      "/library",
    );
    expect(startupEntry({ ...input, mode: "home" })).toBeUndefined();
  });

  it("显式路径、分类链接和移动端不被启动偏好覆盖", () => {
    for (const mode of ["manual", "last"] as const) {
      expect(
        startupEntry({ ...input, mode, pathname: "/settings" }),
      ).toBeUndefined();
      expect(
        startupEntry({ ...input, mode, search: "?category=games" }),
      ).toBeUndefined();
      expect(startupEntry({ ...input, mode, mobile: true })).toBeUndefined();
    }
  });

  it("工具、文库和全部小游戏都能指定或恢复", () => {
    for (const page of [
      "translation",
      "library",
      "billiards",
      "gomoku",
      "go",
      "xiangqi",
    ] as const) {
      for (const mode of ["manual", "last"] as const) {
        expect(
          startupEntry({ ...input, mode, manualPage: page, lastPage: page })
            ?.id,
        ).toBe(page);
      }
    }
  });

  it("未选择、无记录或失效记录停留在首页，不改用其他目标", () => {
    for (const page of [null, "removed-page" as ModuleId]) {
      expect(startupEntry({ ...input, lastPage: page })).toBeUndefined();
      expect(
        startupEntry({ ...input, mode: "manual", manualPage: page }),
      ).toBeUndefined();
    }
  });

  it("单项关闭、分类关闭和旧游戏开关关闭时回退首页", () => {
    for (const mode of ["manual", "last"] as const) {
      const target = {
        ...input,
        mode,
        lastPage: "go",
        manualPage: "go",
      } as const;
      expect(
        startupEntry({ ...target, visibility: { go: false } }),
      ).toBeUndefined();
      expect(
        startupEntry({ ...target, hiddenCategories: ["games"] }),
      ).toBeUndefined();
      expect(startupEntry({ ...target, showGames: false })).toBeUndefined();
      expect(
        startupEntry({
          ...input,
          mode,
          hiddenCategories: ["tools", "library"],
        }),
      ).toBeUndefined();
    }
  });

  it("桌面、Android 与 iOS 按模块能力筛选，不依赖屏幕宽度", () => {
    for (const platform of ["desktop", "android", "ios", "mobile"] as const) {
      const ids = startupPages({ ...input, platform }).map((entry) => entry.id);
      expect(ids.includes("lan-transfer")).toBe(platform === "desktop");
      expect(ids.includes("bt")).toBe(
        platform === "desktop" || platform === "android",
      );
      for (const mode of ["manual", "last"] as const) {
        expect(
          startupEntry({
            ...input,
            mode,
            platform,
            manualPage: "lan-transfer",
            lastPage: "lan-transfer",
          })?.id,
        ).toBe(platform === "desktop" ? "lan-transfer" : undefined);
        expect(
          startupEntry({
            ...input,
            mode,
            platform,
            manualPage: "bt",
            lastPage: "bt",
          })?.id,
        ).toBe(
          platform === "desktop" || platform === "android" ? "bt" : undefined,
        );
      }
    }
  });

  it("手动列表不包含隐藏分类与关闭入口，全部关闭时为空", () => {
    expect(
      startupPages({
        ...input,
        hiddenCategories: ["games"],
        visibility: { crypto: false },
      }).some((entry) => entry.category === "games" || entry.id === "crypto"),
    ).toBe(false);
    const visibility = Object.fromEntries(
      startupPages(input).map((entry) => [entry.id, false]),
    );
    expect(startupPages({ ...input, visibility })).toEqual([]);
    expect(startupEntry({ ...input, visibility })).toBeUndefined();
  });

  it("恢复目标保留入口自带查询参数", () => {
    expect(
      startupEntry({ ...input, lastPage: "media-compress" })?.link,
    ).toMatchObject({
      to: "/tools/media-compress",
      search: { mode: "resize" },
    });
  });
});
