import { describe, expect, it, vi } from "vitest";

import { createBoardSession } from "../engine/board-session";
import type { CheckpointStorage } from "../engine/checkpoint-storage";
import { GameSessionStore } from "../engine/game-session-store";
import { junqiAi } from "./ai";
import { junqiCheckpointSchema } from "./checkpoint";
import { legalMoves } from "./movement";
import { createInitialState, junqiGame } from "./rules";
import type {
  JunqiMode,
  JunqiMove,
  JunqiPresentation,
  JunqiState,
} from "./types";

async function tick() {
  for (let n = 0; n < 30; n++) await Promise.resolve();
}

describe("军棋会话恢复与退出", () => {
  it("布阵和走棋保存有效历史，切页暂停，恢复保留局面且重开使用新对局身份", async () => {
    vi.useFakeTimers();
    const mode: JunqiMode = {
      kind: "ai",
      difficulty: "medium",
      localSeat: 0,
      variant: "open",
    };
    let saved: unknown;
    const storage: CheckpointStorage = {
      read: async () => saved,
      write: async (_, value) => {
        saved = structuredClone(value);
      },
      remove: async () => {
        saved = undefined;
      },
    };
    const make = () =>
      new GameSessionStore<JunqiMode, JunqiState, JunqiMove, JunqiPresentation>(
        {
          gameId: "junqi",
          schema: junqiCheckpointSchema,
          create: (mode, hooks, checkpoint) =>
            createBoardSession(
              mode,
              junqiGame,
              createInitialState(),
              junqiAi,
              hooks,
              checkpoint,
            ),
        },
        storage,
      );
    const store = make();
    let next: ReturnType<typeof make> | undefined;
    try {
      await store.load();
      store.start(mode);
      const session = store.ensureSession();
      if (!session) throw new Error("missing test session");
      const detach = store.attach(() => {}, true);
      await tick();
      session.local.submit({ type: "arrange", seed: 193 });
      await tick();
      expect(junqiCheckpointSchema.safeParse(saved).success).toBe(true);
      session.local.submit({ type: "ready" });
      await vi.advanceTimersByTimeAsync(700);
      await tick();
      const initial = session.runner.getSnapshot().state;
      session.local.submit(legalMoves(initial.board, 0)[0]);
      await tick();
      const position = session.runner.getSnapshot().state;
      expect(position.ply).toBe(1);
      expect(junqiCheckpointSchema.safeParse(saved).success).toBe(true);
      detach();
      await tick();
      expect(session.local.submit({ type: "concede" })).toBe(false);
      store.dispose();
      next = make();
      await next.load();
      next.restore();
      const restored = next.ensureSession();
      expect(restored?.runner.getSnapshot().state).toEqual(position);
      expect(restored?.runner.id).toBe(session.runner.id);
      await next.replace(mode);
      expect(next.ensureSession()?.runner.id).not.toBe(session.runner.id);
      expect(next.ensureSession()?.runner.getSnapshot().state.phase).toBe(
        "deployment",
      );
    } finally {
      store.dispose();
      next?.dispose();
      vi.useRealTimers();
    }
  });
});
