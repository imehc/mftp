import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { checkpointSchema } from "./checkpoint-schema";
import { type CheckpointStorage } from "./checkpoint-storage";
import { LocalController } from "./controllers";
import { GameSessionStore } from "./game-session-store";
import { GameSessionNotice } from "./GameSessionNotice";
import { MatchRunner } from "./match";
import type { GameDefinition } from "./types";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
    getSnapshot(),
}));

i18n.load("zh-CN", {});
i18n.activate("zh-CN");
const game: GameDefinition<number, number, number> = {
  id: "notice-test",
  seatCount: 1,
  currentSeat: () => 0,
  winnerSeat: () => null,
  isFinished: () => false,
  applyMove: (state, move) => ({ state: state + move, presentation: move }),
};
const stores: GameSessionStore<"local", number, number, number>[] = [];

function fixture(saved?: unknown) {
  const storage: CheckpointStorage = {
    read: vi.fn(async () => saved),
    write: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  const store = new GameSessionStore<"local", number, number, number>(
    {
      gameId: game.id,
      schema: checkpointSchema(game.id, z.literal("local"), z.number()),
      create(_mode, hooks, checkpoint) {
        const local = new LocalController<number, number>();
        return {
          local,
          runner: new MatchRunner(game, 0, [local], hooks, checkpoint),
        };
      },
    },
    storage,
  );
  stores.push(store);
  return { store, storage };
}

function markup(store: GameSessionStore<"local", number, number, number>) {
  return renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <GameSessionNotice store={store} />
    </I18nProvider>,
  );
}

afterEach(() => {
  for (const store of stores) store.dispose();
  stores.length = 0;
});

describe("对局存档提示", () => {
  it("读取存档时保留加载反馈", () => {
    const { store } = fixture();
    expect(markup(store)).toContain("正在读取对局存档");
  });

  it("存在存档时保留恢复和丢弃入口", async () => {
    const { store } = fixture({
      version: 1,
      gameId: game.id,
      id: crypto.randomUUID(),
      savedAt: Date.now(),
      mode: "local",
      history: [0],
    });
    await store.load();
    const rendered = markup(store);
    expect(rendered).toContain("发现上次的对局存档，是否继续？");
    expect(rendered).toContain("继续对局");
    expect(rendered).toContain("丢弃存档");
  });

  it("自动保存中和保存成功均不渲染说明或空白提示行", async () => {
    const { store } = fixture();
    await store.load();
    store.start("local");
    expect(store.ensureSession()).not.toBeNull();
    expect(store.getSnapshot().saving).toBe(true);
    expect(markup(store)).toBe("");
    for (let index = 0; index < 16; index++) await Promise.resolve();
    expect(store.getSnapshot().saving).toBe(false);
    expect(store.getSnapshot().savedAt).not.toBeNull();
    expect(markup(store)).toBe("");
  });

  it("读取失败仍展示错误与重试入口", async () => {
    const { store, storage } = fixture();
    vi.mocked(storage.read).mockRejectedValue(new Error("read failed"));
    await store.load();
    expect(store.getSnapshot().error).not.toBeNull();
    const rendered = markup(store);
    expect(rendered).toContain("destructive");
    expect(rendered).toContain("重试");
  });
});
