import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { checkpointSchema } from "./checkpoint-schema";
import type { CheckpointStorage } from "./checkpoint-storage";
import { LocalController } from "./controllers";
import { GameSessionStore } from "./game-session-store";
import { type MatchHooks, MatchRunner } from "./match";
import { setGamesForeground } from "./session-registry";
import type { GameDefinition } from "./types";

const schema = checkpointSchema("test", z.literal("local"), z.number());
const game: GameDefinition<number, number, number> = {
  id: "test",
  seatCount: 1,
  currentSeat: () => 0,
  winnerSeat: () => null,
  isFinished: (state) => state >= 10,
  applyMove: (state, move) => ({ state: state + move, presentation: move }),
};

const tick = async () => {
  for (let index = 0; index < 16; index++) await Promise.resolve();
};

const stores: GameSessionStore<"local", number, number, number>[] = [];

function fixture(initial?: unknown, version = 1) {
  let value = initial;
  const storage: CheckpointStorage = {
    read: vi.fn(async () => value),
    write: vi.fn(async (_gameId, checkpoint) => {
      value = structuredClone(checkpoint);
    }),
    remove: vi.fn(async () => {
      value = undefined;
    }),
  };
  const create = vi.fn(
    (
      mode: "local",
      hooks: MatchHooks<number, number, number>,
      checkpoint: { id: string; history?: number[] },
    ) => {
      expect(mode).toBe("local");
      const local = new LocalController<number, number>();
      return {
        runner: new MatchRunner(game, 0, [local], hooks, checkpoint),
        local,
      };
    },
  );
  const store = new GameSessionStore(
    {
      gameId: "test",
      checkpointVersion: version,
      schema: checkpointSchema("test", z.literal("local"), z.number(), version),
      create,
    },
    storage,
  );
  stores.push(store);
  return { store, storage, create, value: () => value };
}

afterEach(() => {
  for (const store of stores) store.dispose();
  stores.length = 0;
  setGamesForeground(true);
});

describe("跨页面会话与跨进程检查点", () => {
  it("检查点版本可独立演进，不猜测恢复不兼容规则的存档", async () => {
    const first = fixture(undefined, 2);
    await first.store.load();
    first.store.start("local");
    first.store.ensureSession();
    await tick();
    const sameVersion = fixture(first.value(), 2);
    await sameVersion.store.load();
    expect(sameVersion.store.getSnapshot().saved?.version).toBe(2);
    const incompatible = fixture(first.value(), 1);
    await incompatible.store.load();
    expect(incompatible.store.getSnapshot().error?.code).toBe(
      "games:checkpoint_invalid",
    );
  });

  it("退出清理失败时补存并发结算的走法，不丢最新进度", async () => {
    const { store, storage, value } = fixture();
    await store.load();
    store.start("local");
    const session = store.ensureSession()!;
    store.attach(() => {}, true);
    await tick();
    let fail!: (reason: unknown) => void;
    vi.mocked(storage.remove).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    session.local.submit(2);
    const exiting = store.exit();
    await tick();
    expect(session.runner.getSnapshot().state).toBe(2);
    fail(new Error("isolated delete failure"));
    expect(await exiting).toBe(false);
    await tick();
    expect(schema.parse(value()).history).toEqual([0, 2]);
  });

  it("系统后台暂停本地回合，返回前台不丢会话", async () => {
    const { store } = fixture();
    await store.load();
    store.start("local");
    const session = store.ensureSession()!;
    store.attach(() => {}, true);
    setGamesForeground(false);
    await tick();
    expect(session.local.submit(2)).toBe(false);
    setGamesForeground(true);
    await tick();
    expect(session.local.submit(2)).toBe(true);
    await tick();
    expect(session.runner.getSnapshot().state).toBe(2);
  });

  it("页面脱离与重新附着不重建会话，后台不处理新回合", async () => {
    const { store, create } = fixture();
    await store.load();
    store.start("local");
    const session = store.ensureSession()!;
    const dispose = vi.spyOn(session.runner, "dispose");
    const detach = store.attach(() => {}, true);
    session.local.submit(2);
    await tick();
    detach();
    await tick();
    expect(dispose).not.toHaveBeenCalled();
    expect(session.local.submit(3)).toBe(false);
    expect(store.ensureSession()).toBe(session);
    store.attach(() => {}, true);
    await tick();
    expect(session.local.submit(3)).toBe(true);
    await tick();
    expect(session.runner.getSnapshot().state).toBe(5);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("新实例读取存档后等待明确恢复，标识与悔棋历史完整", async () => {
    const first = fixture();
    await first.store.load();
    first.store.start("local");
    const session = first.store.ensureSession()!;
    first.store.attach(() => {}, true);
    session.local.submit(2);
    await tick();
    const id = session.runner.id;
    first.store.dispose();
    const second = fixture(first.value());
    await second.store.load();
    expect(second.store.getSnapshot().active).toBeNull();
    expect(second.create).not.toHaveBeenCalled();
    second.store.restore();
    const restored = second.store.ensureSession()!;
    expect(restored.runner.id).toBe(id);
    expect(restored.runner.getCheckpoint()).toEqual([0, 2]);
    expect(restored.runner.undo(1)).toBe(true);
    await tick();
    expect(schema.parse(second.value()).history).toEqual([0]);
  });

  it("读取失败或未知版本不当作空存档或静默覆盖", async () => {
    const { store, storage } = fixture({ version: 99 });
    await store.load();
    expect(store.getSnapshot().error?.code).toBe("games:checkpoint_invalid");
    store.start("local");
    expect(store.getSnapshot().active).toBeNull();
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    vi.mocked(storage.read).mockRejectedValueOnce(new Error("read failed"));
    await store.load();
    expect(store.getSnapshot().error?.code).toBe("games:checkpoint_read");
    vi.mocked(storage.read).mockResolvedValueOnce(undefined);
    await store.load();
    expect(store.getSnapshot().status).toBe("ready");
  });

  it("保存失败不终止游戏或伪报成功，重试保存最新检查点", async () => {
    const { store, storage } = fixture();
    await store.load();
    vi.mocked(storage.write).mockRejectedValueOnce(new Error("quota"));
    store.start("local");
    store.ensureSession();
    await tick();
    expect(store.getSnapshot().savedAt).toBeNull();
    expect(store.getSnapshot().error?.code).toBe("games:checkpoint_write");
    store.retrySave();
    await tick();
    expect(store.getSnapshot().savedAt).not.toBeNull();
    expect(store.getSnapshot().error).toBeNull();
  });

  it("重开只清理旧资源一次，新代次不接受旧控制器输入", async () => {
    const { store } = fixture();
    await store.load();
    store.start("local");
    const previous = store.ensureSession()!;
    store.attach(() => {}, true);
    const dispose = vi.spyOn(previous.runner, "dispose");
    await store.replace("local");
    const next = store.ensureSession()!;
    expect(next.runner.id).not.toBe(previous.runner.id);
    expect(previous.local.submit(2)).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("删除失败保留现有对局和检查点，重试成功才结束", async () => {
    const { store, storage } = fixture();
    await store.load();
    store.start("local");
    const session = store.ensureSession()!;
    store.attach(() => {}, true);
    await tick();
    vi.mocked(storage.remove).mockRejectedValueOnce(new Error("delete failed"));
    expect(await store.exit()).toBe(false);
    expect(store.getSnapshot().active?.session).toBe(session);
    expect(store.getSnapshot().error?.code).toBe("games:checkpoint_delete");
    await tick();
    expect(session.local.submit(2)).toBe(true);
    expect(await store.exit()).toBe(true);
    expect(store.getSnapshot().active).toBeNull();
  });

  it("旧保存回调迟到时不能改变新代次的状态", async () => {
    const { store, storage } = fixture();
    await store.load();
    let finish!: () => void;
    vi.mocked(storage.write).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    store.start("local");
    store.ensureSession();
    await store.replace("local");
    const id = store.getSnapshot().active?.id;
    store.ensureSession();
    await tick();
    finish();
    await tick();
    expect(store.getSnapshot().active?.id).toBe(id);
    expect(store.getSnapshot().saving).toBe(false);
  });
});
