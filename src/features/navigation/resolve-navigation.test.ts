import { describe, expect, it } from "vitest";

import { resolveNavigation } from "./resolve-navigation";

const context = { showGames: false, settingsDetail: false };

describe("导航框架与页面层级", () => {
  it("未登记具体名称的新工具也接入工具导航", () => {
    expect(
      resolveNavigation({ ...context, pathname: "/tools/new-tool" }),
    ).toEqual({ active: "tools", primary: false });
    expect(
      resolveNavigation({ ...context, pathname: "/tools/new-tool/details" }),
    ).toEqual({ active: "tools", primary: false });
    expect(
      resolveNavigation({ ...context, pathname: "/toolsmith" }),
    ).toBeNull();
  });

  it("首页分类尊重小游戏开关并保留一级导航", () => {
    expect(
      resolveNavigation({ ...context, pathname: "/", homeCategory: "games" }),
    ).toEqual({ active: "tools", primary: true });
    expect(
      resolveNavigation({
        ...context,
        pathname: "/",
        homeCategory: "games",
        showGames: true,
      }),
    ).toEqual({ active: "games", primary: true });
    expect(
      resolveNavigation({ ...context, pathname: "/", homeCategory: "library" }),
    ).toEqual({ active: "library", primary: true });
  });

  it("文库列表与选择诗词后的详情有不同层级", () => {
    expect(resolveNavigation({ ...context, pathname: "/library/" })).toEqual({
      active: "library",
      primary: true,
    });
    for (const value of [
      { pathname: "/library", selectedPoem: "poem-1" },
      { pathname: "/library/poem-1" },
      { pathname: "/library/manage" },
    ]) {
      expect(resolveNavigation({ ...context, ...value })).toEqual({
        active: "library",
        primary: false,
      });
    }
  });

  it("设置详情和关联页面保持设置归属且不展示一级底栏", () => {
    expect(resolveNavigation({ ...context, pathname: "/settings" })).toEqual({
      active: "settings",
      primary: true,
    });
    for (const pathname of ["/settings", "/logs", "/about"]) {
      expect(
        resolveNavigation({ ...context, pathname, settingsDetail: true }),
      ).toEqual({ active: "settings", primary: false });
    }
  });

  it("游戏与预览保留归属，未知路径不获得默认工具框架", () => {
    expect(resolveNavigation({ ...context, pathname: "/games/go" })).toEqual({
      active: "games",
      primary: false,
    });
    expect(resolveNavigation({ ...context, pathname: "/preview" })).toEqual({
      active: "tools",
      primary: false,
    });
    expect(
      resolveNavigation({ ...context, pathname: "/library-other" }),
    ).toBeNull();
    expect(resolveNavigation({ ...context, pathname: "/unknown" })).toBeNull();
    // 活动页是全屏页面，不能获得默认导航框架和移动底栏。
    expect(resolveNavigation({ ...context, pathname: "/activity" })).toBeNull();
    expect(
      resolveNavigation({ ...context, pathname: "/activity/" }),
    ).toBeNull();
  });
});
