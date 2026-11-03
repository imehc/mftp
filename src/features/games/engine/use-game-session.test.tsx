// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { TaskInterruption } from "~/lib/task-interruption";

import { createInitialGomokuState, gomokuGame } from "../gomoku/rules";
import type { GomokuMove, GomokuState } from "../gomoku/types";
import { checkpointSchema } from "./checkpoint-schema";
import { ComputerController, LocalController } from "./controllers";
import { GameSessionStore } from "./game-session-store";
import { MatchRunner, useMatchSnapshot } from "./match";
import { setGamesForeground } from "./session-registry";
import { useLocalGameSession } from "./use-game-session";

function fixture() {
  const calls: { signal: AbortSignal; resolve(move: GomokuMove): void }[] = [];
  const request = vi.fn(
    (
      _observation: GomokuState,
      _seat: number,
      _difficulty: string,
      signal: AbortSignal,
    ) =>
      new Promise<GomokuMove>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        calls.push({
          signal,
          resolve: (move) => {
            signal.removeEventListener("abort", abort);
            resolve(move);
          },
        });
      }),
  );
  const controller = new ComputerController(
    { chooseMove: request },
    "medium",
    0,
  );
  const store = new GameSessionStore(
    {
      gameId: "gomoku",
      schema: checkpointSchema(
        "gomoku",
        z.literal("computer"),
        z.custom<GomokuState>(),
      ),
      create: (_mode, hooks, checkpoint) => {
        const local = new LocalController<GomokuState, GomokuMove>();
        return {
          local,
          runner: new MatchRunner(
            gomokuGame,
            createInitialGomokuState(),
            [local, controller],
            hooks,
            checkpoint,
          ),
        };
      },
    },
    {
      read: vi.fn(async () => undefined),
      write: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    },
  );
  const attach = vi.spyOn(store, "attach");
  const presentation = vi.fn();

  function Consumer({ revision }: { revision: number }) {
    const session = useLocalGameSession(store, (info) =>
      presentation(revision, info),
    );
    return session ? <Snapshot runner={session.runner} /> : null;
  }

  function Snapshot({
    runner,
  }: {
    runner: NonNullable<ReturnType<typeof store.ensureSession>>["runner"];
  }) {
    useMatchSnapshot(runner);
    return null;
  }

  return { store, controller, request, calls, attach, presentation, Consumer };
}

let root: Root;
let container: HTMLDivElement;
const cleanups: (() => void)[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setGamesForeground(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  cleanups.splice(0).forEach((cleanup) => cleanup());
  container.remove();
  setGamesForeground(true);
  vi.unstubAllGlobals();
});

describe("电脑对局页面的会话附着", () => {
  it("第六手等待期间保存、重渲染及更新表现回调不会取消或重建请求", async () => {
    const f = fixture();
    cleanups.push(() => f.store.dispose());
    await f.store.load();
    f.store.start("computer");
    await act(async () => root.render(<f.Consumer revision={0} />));
    const session = f.store.ensureSession()!;
    for (const [index, move] of [
      { row: 7, col: 7 },
      { row: 6, col: 8 },
      { row: 5, col: 9 },
    ].entries()) {
      await act(async () => {
        expect(session.local.submit(move)).toBe(true);
      });
      if (index < 2)
        await act(async () =>
          f.calls[index].resolve(
            index === 0 ? { row: 7, col: 8 } : { row: 6, col: 7 },
          ),
        );
    }
    expect(session.runner.getSnapshot().state.moveCount).toBe(5);
    expect(f.calls).toHaveLength(3);
    for (let revision = 1; revision <= 5; revision++) {
      await act(async () => root.render(<f.Consumer revision={revision} />));
      await act(async () => f.store.retrySave());
      expect(f.store.ensureSession()).toBe(session);
      expect(f.calls[2].signal.aborted).toBe(false);
      expect(session.runner.getSnapshot().activeSeat).toBe(1);
    }
    expect(f.attach).toHaveBeenCalledOnce();
    await act(async () => f.calls[2].resolve({ row: 4, col: 10 }));
    expect(session.runner.getSnapshot().state.moveCount).toBe(6);
    expect(f.presentation.mock.calls.at(-1)?.[0]).toBe(5);
    expect(f.request).toHaveBeenCalledTimes(3);
  });

  it("真正后台才取消，回到前台继续后保持同一局面", async () => {
    const f = fixture();
    cleanups.push(() => f.store.dispose());
    await f.store.load();
    f.store.start("computer");
    await act(async () => root.render(<f.Consumer revision={0} />));
    const session = f.store.ensureSession()!;
    await act(async () => {
      session.local.submit({ row: 7, col: 7 });
    });
    await act(async () => setGamesForeground(false));
    expect(f.calls[0].signal.aborted).toBe(true);
    expect(f.calls[0].signal.reason).toBeInstanceOf(TaskInterruption);
    expect(f.calls[0].signal.reason.source).toBe("appHidden");
    await act(async () => setGamesForeground(true));
    expect(f.calls).toHaveLength(2);
    expect(session.runner.getSnapshot().state.moveCount).toBe(1);
    await act(async () => f.calls[1].resolve({ row: 7, col: 8 }));
    expect(session.runner.getSnapshot().state.moveCount).toBe(2);
    expect(f.request).toHaveBeenCalledTimes(2);
  });

  it("页面卸载与悔棋会将不同取消来源传给原电脑搜索", async () => {
    const f = fixture();
    cleanups.push(() => f.store.dispose());
    await f.store.load();
    f.store.start("computer");
    await act(async () => root.render(<f.Consumer revision={0} />));
    const session = f.store.ensureSession()!;
    await act(async () => {
      session.local.submit({ row: 7, col: 7 });
    });
    await act(async () => {
      expect(session.runner.undo(1)).toBe(true);
    });
    expect(f.calls[0].signal.reason.source).toBe("positionChanged");
    await act(async () => {
      session.local.submit({ row: 6, col: 6 });
    });
    expect(f.calls).toHaveLength(2);
    await act(async () => root.render(null));
    expect(f.calls[1].signal.reason.source).toBe("viewDetached");
  });
});
