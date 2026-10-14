import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("恢复或反复挂载已结束对局不重复记录，也不改变原完成时间", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  vi.stubGlobal("window", { localStorage });
  const { useGamesHistoryStore } = await import("./history");
  const record = {
    id: "stable-round",
    gameId: "gomoku",
    finishedAt: 10,
    payload: { moves: 20 },
  };
  useGamesHistoryStore.getState().addRecord(record);
  useGamesHistoryStore.getState().addRecord({ ...record, finishedAt: 30 });
  expect(useGamesHistoryStore.getState().records).toEqual([record]);
  expect(JSON.parse(values.get("mftp-games-history")!).state.records).toEqual([
    record,
  ]);
});
