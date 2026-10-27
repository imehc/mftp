import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";

import {
  createReadingSessionStore,
  MAX_READING_SNAPSHOTS,
} from "./reading-session";

function memoryStorage(): StateStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("诗词阅读会话", () => {
  it("重建存储恢复作品、来源和分面板位置，持久内容不含操作函数", () => {
    const storage = memoryStorage();
    const state = createReadingSessionStore(storage).getState();
    state.rememberLocation({
      page: "detail",
      uid: "甲",
      q: "春",
      view: "annotations",
    });
    state.update("甲", {
      view: "annotations",
      strainsOpen: true,
      positions: { "mobile-annotations": 380 },
    });
    state.update("甲", { positions: { "desktop-translation": 900 } });
    const restored = createReadingSessionStore(storage).getState();
    expect(restored.location).toEqual({
      page: "detail",
      uid: "甲",
      q: "春",
      view: "annotations",
    });
    expect(restored.entries[0]).toMatchObject({
      strainsOpen: true,
      positions: { "mobile-annotations": 380, "desktop-translation": 900 },
    });
    expect(typeof restored.update).toBe("function");
  });

  it("按最近访问淘汰，打开新作品清除旧位置但不影响其他作品", () => {
    const store = createReadingSessionStore(memoryStorage());
    for (let i = 0; i < MAX_READING_SNAPSHOTS; i++)
      store
        .getState()
        .update(String(i), { positions: { "mobile-original": 100 } });
    store.getState().update("0", { view: "annotations" });
    store.getState().update("新", { view: "translation" });
    expect(store.getState().entries).toHaveLength(MAX_READING_SNAPSHOTS);
    expect(store.getState().entries.some((entry) => entry.uid === "1")).toBe(
      false,
    );
    store.getState().begin("0", "translation", "translation");
    expect(store.getState().entries.at(-1)).toEqual({
      uid: "0",
      view: "translation",
      referenceView: "translation",
      positions: {},
    });
    expect(
      store.getState().entries.find((entry) => entry.uid === "2")?.positions[
        "mobile-original"
      ],
    ).toBe(100);
  });

  it("坏标签、非法来源及负数坐标不进入恢复状态", () => {
    const storage = memoryStorage();
    storage.setItem(
      "mftp-poetry-reading-session",
      JSON.stringify({
        version: 1,
        state: {
          location: { page: "https://example.com", uid: "甲" },
          entries: [
            {
              uid: "甲",
              view: "unknown",
              positions: {
                "mobile-original": -1,
                "mobile-annotations": 200,
                "desktop-translation": 1e20,
              },
            },
          ],
        },
      }),
    );
    const restored = createReadingSessionStore(storage).getState();
    expect(restored.location).toBeNull();
    expect(restored.entries[0].view).toBeUndefined();
    expect(restored.entries[0].positions).toEqual({
      "mobile-annotations": 200,
    });
  });

  it("无法解析的存储不会阻止新会话更新", () => {
    const storage = memoryStorage();
    storage.setItem("mftp-poetry-reading-session", "broken json");
    const store = createReadingSessionStore(storage);
    store.getState().update("甲", { view: "annotations" });
    expect(store.getState().entries[0].view).toBe("annotations");
  });
});
