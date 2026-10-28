import { afterEach, describe, expect, it, vi } from "vitest";

import type { CheckpointStorage } from "../engine/checkpoint-storage";
import { setGamesForeground } from "../engine/session-registry";
import {
  checkpointBoard,
  MAX_PUZZLE_HISTORY,
  puzzleCheckpointSchema,
} from "./checkpoint";
import { createSolved, moveTile } from "./engine";
import { PuzzleSession } from "./session";

const sessions: PuzzleSession[] = [];

function setup(saved?: unknown) {
  let stored = saved;
  const storage: CheckpointStorage = {
    read: vi.fn(async () => stored),
    write: vi.fn(async (_, value) => {
      stored = structuredClone(value);
    }),
    remove: vi.fn(async () => {
      stored = undefined;
    }),
  };
  const record = vi.fn();
  const session = new PuzzleSession(storage, () => Date.now(), record);
  const detach = session.attach();
  sessions.push(session);
  return { session, storage, record, detach, stored: () => stored };
}

async function fixture() {
  const seed = setup();
  await seed.session.load();
  const initial = moveTile(moveTile(createSolved(3), 8), 7);
  return { ...seed.session.getSnapshot().data, initial, base: initial };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  setGamesForeground(true);
  vi.useRealTimers();
});

describe("数字华容道会话", () => {
  it("恢复、撤销、重做和分支与存档重放一致", async () => {
    const { session, stored } = setup(await fixture());
    await session.load();
    expect(session.move(7)).toBe(false);
    session.restore();
    const initial = session.getSnapshot().board;
    session.move(7);
    const moved = session.getSnapshot().board;
    session.undo();
    expect(session.getSnapshot().board).toEqual(initial);
    session.redo();
    expect(session.getSnapshot().board).toEqual(moved);
    session.undo();
    session.move(4);
    expect(session.redo()).toBe(false);
    expect(session.getSnapshot().data.assisted).toBe(true);
    await settle();
    expect(checkpointBoard(puzzleCheckpointSchema.parse(stored()))).toEqual(
      session.getSnapshot().board,
    );
  });

  it("重新开始保留本局排列，更换会话并清零", async () => {
    const { session } = setup(await fixture());
    await session.load();
    session.restore();
    const original = session.getSnapshot().data;
    session.move(7);
    session.restart();
    expect(session.getSnapshot().data.id).not.toBe(original.id);
    expect(session.getSnapshot().board).toEqual(original.initial);
    expect(session.getSnapshot().data.started).toBe(false);
    session.newGame(5);
    expect(session.getSnapshot().board.size).toBe(5);
    expect(session.getSnapshot().data.moves).toHaveLength(0);
  });

  it("首次移动计时，弹窗后台和切页暂停，完成仅记录一次", async () => {
    vi.useFakeTimers();
    const { session, record, detach } = setup(await fixture());
    await session.load();
    session.restore();
    vi.advanceTimersByTime(2000);
    expect(session.getSnapshot().data.elapsedMs).toBe(0);
    session.move(7);
    vi.advanceTimersByTime(1000);
    session.setEnabled(false);
    vi.advanceTimersByTime(2000);
    expect(session.getSnapshot().data.elapsedMs).toBe(1000);
    session.setEnabled(true);
    setGamesForeground(false);
    vi.advanceTimersByTime(2000);
    setGamesForeground(true);
    vi.advanceTimersByTime(500);
    detach();
    vi.advanceTimersByTime(2000);
    session.attach();
    expect(session.getSnapshot().data.elapsedMs).toBe(1500);
    session.move(8);
    expect(session.getSnapshot().data.completed).toBe(true);
    expect(record).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(session.getSnapshot().data.elapsedMs).toBe(1500);
    expect(session.move(8)).toBe(false);
    session.save();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("损坏和读取失败保留原存档，丢弃后才开始新局", async () => {
    const { session, storage } = setup({ version: 99 });
    await session.load();
    expect(session.getSnapshot().error?.code).toBe("games:checkpoint_invalid");
    session.newGame(5);
    expect(storage.write).not.toHaveBeenCalled();
    vi.mocked(storage.read).mockRejectedValueOnce(new Error("read failed"));
    await session.load();
    expect(session.getSnapshot().error?.code).toBe("games:checkpoint_read");
    await session.discard();
    expect(session.getSnapshot().status).toBe("ready");
  });

  it("历史上限折叠基准但保留初始盘面与累计步数", async () => {
    const { session } = setup(await fixture());
    await session.load();
    session.restore();
    const initial = session.getSnapshot().board;
    for (let i = 0; i < MAX_PUZZLE_HISTORY + 3; i++) session.move(7);
    const data = session.getSnapshot().data;
    expect(data.moves).toHaveLength(MAX_PUZZLE_HISTORY);
    expect(data.cursor + data.offset).toBe(MAX_PUZZLE_HISTORY + 3);
    expect(data.initial).toEqual(initial);
    expect(puzzleCheckpointSchema.safeParse(data).success).toBe(true);
    session.restart();
    expect(session.getSnapshot().board).toEqual(initial);
  });

  it("保存和成绩写入失败可重试，合法动作不回退", async () => {
    const { session, storage, record } = setup(await fixture());
    await session.load();
    session.restore();
    await settle();
    vi.mocked(storage.write).mockRejectedValueOnce(new Error("write failed"));
    session.move(7);
    await settle();
    expect(session.getSnapshot().data.cursor).toBe(1);
    expect(session.getSnapshot().error?.code).toBe("games:checkpoint_write");
    session.save();
    await settle();
    expect(session.getSnapshot().error).toBeNull();
    record.mockImplementationOnce(() => {
      throw new Error("record failed");
    });
    session.move(8);
    expect(session.getSnapshot().error?.code).toBe("sliding-puzzle:history");
    session.save();
    expect(record).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().error).toBeNull();
  });

  it("旧写入失败不能污染新局，销毁后不会再保存", async () => {
    const { session, storage } = setup(await fixture());
    await session.load();
    session.restore();

    let reject = (_: Error) => {};

    vi.mocked(storage.write).mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    session.move(7);
    session.newGame(5);
    reject(new Error("stale write failed"));
    await settle();
    expect(session.getSnapshot().error).toBeNull();
    session.dispose();
    const writes = vi.mocked(storage.write).mock.calls.length;
    session.save();
    session.newGame(3);
    expect(storage.write).toHaveBeenCalledTimes(writes);
  });

  it("存档拒绝非法重做分支和不一致的完成标记", async () => {
    const data = await fixture();
    expect(
      puzzleCheckpointSchema.safeParse({
        ...data,
        started: true,
        moves: [7, 1],
        cursor: 1,
      }).success,
    ).toBe(false);
    expect(
      puzzleCheckpointSchema.safeParse({ ...data, completed: true }).success,
    ).toBe(false);
    expect(
      puzzleCheckpointSchema.safeParse({ ...data, base: createSolved(3) })
        .success,
    ).toBe(false);
  });
});
