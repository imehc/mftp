// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore as store } from "./settings";

async function migrate(state: Record<string, unknown>) {
  return (await store.persist.getOptions().migrate?.(state, 8)) as ReturnType<
    typeof store.getState
  >;
}

beforeEach(() => {
  localStorage.clear();
  store.setState(store.getInitialState(), true);
});

describe("启动偏好迁移与持久化", () => {
  it("保留原有恢复默认值和工具记录，同时兼容旧压缩入口", async () => {
    expect(
      await migrate({ lastTool: "library", locale: "en", showGames: true }),
    ).toMatchObject({
      startupMode: "last",
      lastPage: "library",
      locale: "en",
      hiddenHomeCategories: [],
    });
    expect(await migrate({ lastTool: "video-compress" })).toMatchObject({
      startupMode: "last",
      lastPage: "media-compress",
    });
    expect(
      await migrate({ restoreLastTool: false, lastTool: "crypto" }),
    ).toMatchObject({ startupMode: "home", lastPage: "crypto" });
  });

  it("显式首页模式不会被遗留恢复开关覆盖", async () => {
    expect(
      await migrate({
        startupMode: "home",
        restoreLastTool: true,
        lastPage: "go",
      }),
    ).toMatchObject({ startupMode: "home", lastPage: "go" });
  });

  it("保留有效手动目标与平台专属目标，清理无效记录", async () => {
    expect(
      await migrate({
        startupMode: "manual",
        manualPage: "lan-transfer",
        lastPage: "bt",
      }),
    ).toMatchObject({
      startupMode: "manual",
      manualPage: "lan-transfer",
      lastPage: "bt",
    });
    expect(
      await migrate({
        startupMode: "invalid",
        manualPage: "removed",
        lastPage: "removed",
        lastTool: "crypto",
      }),
    ).toMatchObject({ startupMode: "last", manualPage: null, lastPage: null });
    expect(await migrate({ lastPage: null, lastTool: "crypto" })).toMatchObject(
      { lastPage: null },
    );
  });

  it("启动模式、手动页面与小游戏记录持久化后能重新读取", async () => {
    store.getState().setStartupMode("manual");
    store.getState().setManualPage("xiangqi");
    store.getState().setLastPage("go");
    const saved = localStorage.getItem("mftp-settings")!;
    expect(JSON.parse(saved).version).toBe(9);
    store.setState({ startupMode: "home", manualPage: null, lastPage: null });
    localStorage.setItem("mftp-settings", saved);
    await store.persist.rehydrate();
    expect(store.getState()).toMatchObject({
      startupMode: "manual",
      manualPage: "xiangqi",
      lastPage: "go",
    });
  });

  it("工具访问更新统一页面记录，游戏访问不覆盖手动目标和模式", () => {
    store.getState().setStartupMode("manual");
    store.getState().setManualPage("library");
    store.getState().setLastTool("translation");
    expect(store.getState()).toMatchObject({
      lastPage: "translation",
      lastTool: "translation",
    });
    store.getState().setLastPage("billiards");
    expect(store.getState()).toMatchObject({
      lastPage: "billiards",
      startupMode: "manual",
      manualPage: "library",
    });
  });

  it("旧游戏快捷开关与分类开关保持一致，且保留其他隐藏分类", () => {
    store.getState().setHomeCategoryVisible("tools", false);
    store.getState().setShowGames(true);
    expect(store.getState()).toMatchObject({
      showGames: true,
      hiddenHomeCategories: ["tools"],
    });
    store.getState().setShowGames(false);
    expect(store.getState()).toMatchObject({
      showGames: false,
      hiddenHomeCategories: ["tools", "games"],
    });
    store.getState().setHomeCategoryVisible("games", true);
    expect(store.getState()).toMatchObject({
      showGames: true,
      hiddenHomeCategories: ["tools"],
    });
  });
});
