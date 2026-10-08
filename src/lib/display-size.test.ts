import { afterEach, expect, it, vi } from "vitest";

import {
  applyDisplaySize,
  applyStoredDisplaySize,
  resolveDisplaySize,
} from "./display-size";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("旧偏好与损坏倍率回退，不接受范围外或非数字比例", () => {
  expect(resolveDisplaySize(undefined)).toEqual({ mode: "system", scale: 1 });
  for (const scale of [NaN, Infinity, 0, 2, "1.25", null])
    expect(resolveDisplaySize({ mode: "manual", scale })).toEqual({
      mode: "manual",
      scale: 1,
    });
  expect(resolveDisplaySize({ mode: "invalid", scale: 1.25 })).toEqual({
    mode: "system",
    scale: 1.25,
  });
});

it("首屏恢复保存比例，恢复系统模式只清理应用倍率", () => {
  const properties = new Map([["--safe-top", "24px"]]);
  vi.stubGlobal("document", {
    documentElement: {
      style: {
        setProperty: (key: string, value: string) => properties.set(key, value),
        removeProperty: (key: string) => properties.delete(key),
      },
    },
  });
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({
        state: { displaySize: { mode: "manual", scale: 1.25 } },
      }),
  });
  applyStoredDisplaySize();
  expect(properties.get("--ui-scale")).toBe("1.25");
  applyDisplaySize({ mode: "system", scale: 1.25 });
  expect(properties.has("--ui-scale")).toBe(false);
  expect(properties.get("--safe-top")).toBe("24px");
  vi.stubGlobal("localStorage", { getItem: () => "broken" });
  expect(() => applyStoredDisplaySize()).not.toThrow();
});

it("设置迁移保留既有用户偏好，手动选择可持久化并重新读取", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", { localStorage });
  const { useSettingsStore: store } = await import("../store/settings");
  const migrated = (await store.persist.getOptions().migrate?.(
    {
      locale: "en",
      colorTheme: "tiesen",
      fontPreset: "outfit",
      lastTool: "library",
    },
    5,
  )) as ReturnType<typeof store.getState>;
  expect(migrated).toMatchObject({
    locale: "en",
    colorTheme: "tiesen",
    fontPreset: "outfit",
    lastTool: "library",
    displaySize: { mode: "system", scale: 1 },
  });
  store.getState().setDisplaySize({ mode: "manual", scale: 1.125 });
  const saved = storage.get("mftp-settings")!;
  expect(JSON.parse(saved).state.displaySize).toEqual({
    mode: "manual",
    scale: 1.125,
  });
  store.setState({ displaySize: { mode: "system", scale: 1 } });
  storage.set("mftp-settings", saved);
  await store.persist.rehydrate();
  expect(store.getState().displaySize).toEqual({
    mode: "manual",
    scale: 1.125,
  });
  store.getState().setLocale("en");
  store.getState().setColorTheme("tiesen");
  expect(store.getState().displaySize.scale).toBe(1.125);
});
