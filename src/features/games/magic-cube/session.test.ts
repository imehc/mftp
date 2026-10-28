import { afterEach, describe, expect, it, vi } from "vitest";

import type { CheckpointStorage } from "../engine/checkpoint-storage";
import { setGamesForeground } from "../engine/session-registry";
import {
  checkpointState,
  cubeCheckpointSchema,
  MAX_HISTORY,
} from "./checkpoint";
import { applyMove, createCube, inverseMove } from "./engine";
import { CubeSession } from "./session";
import type { CubeMove } from "./types";

const sessions: CubeSession[] = [];
const turn: CubeMove = { axis: 0, layer: 0, turns: 1 };

function setup(saved?: unknown, presenter = () => Promise.resolve()) {
  let stored = saved;
  const storage: CheckpointStorage = {
    read: vi.fn(async () => stored),
    write: vi.fn(async (_, data) => {
      stored = structuredClone(data);
    }),
    remove: vi.fn(async () => {
      stored = undefined;
    }),
  };
  const record = vi.fn();
  const session = new CubeSession(storage, () => Date.now(), record);
  session.attach(presenter);
  sessions.push(session);
  return { session, storage, record, stored: () => stored };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  setGamesForeground(true);
  vi.useRealTimers();
});

describe("魔方会话与恢复", () => {
  it("撤销、重做以及新分支始终重建相同局面", async () => {
    const { session, stored } = setup();
    await session.load();
    session.turn(turn);
    await settle();
    const once = session.getSnapshot().cube;
    session.undo();
    await settle();
    expect(session.getSnapshot().cube).toEqual(createCube(3));
    session.redo();
    await settle();
    expect(session.getSnapshot().cube).toEqual(once);
    session.undo();
    await settle();
    session.turn({ axis: 1, layer: 1, turns: 2 });
    await settle();
    expect(session.getSnapshot().data.moves).toHaveLength(1);
    const checkpoint = cubeCheckpointSchema.parse(stored());
    expect(checkpointState(checkpoint)).toEqual(session.getSnapshot().cube);
  });

  it("损坏或读取失败不会被当作新游戏并覆盖", async () => {
    const { session, storage } = setup({ version: 99 });
    await session.load();
    expect(session.getSnapshot().error?.code).toBe("games:checkpoint_invalid");
    session.newCube(2);
    expect(storage.write).not.toHaveBeenCalled();
    vi.mocked(storage.read).mockRejectedValueOnce(new Error("read failed"));
    await session.load();
    expect(session.getSnapshot().error?.code).toBe("games:checkpoint_read");
    await session.discard();
    expect(session.getSnapshot().status).toBe("ready");
  });

  it("存档恢复保持阶数、重做分支和计数", async () => {
    const first = setup();
    await first.session.load();
    first.session.newCube(7);
    first.session.turn(turn);
    await settle();
    first.session.undo();
    await settle();
    const second = setup(first.stored());
    await second.session.load();
    expect(second.session.getSnapshot().saved).not.toBeNull();
    second.session.restore();
    second.session.redo();
    await settle();
    expect(second.session.getSnapshot().cube).toEqual(
      applyMove(createCube(7), turn),
    );
    expect(second.session.getSnapshot().data.assisted).toBe(true);
  });

  it("计时从首次操作开始，弹窗和后台暂停，完成只记录一次", async () => {
    vi.useFakeTimers();
    const { session, record } = setup();
    await session.load();
    session.newCube(3, true);
    vi.advanceTimersByTime(2000);
    expect(session.getSnapshot().elapsedMs).toBe(0);
    session.turn(turn);
    await settle();
    vi.advanceTimersByTime(1000);
    session.setEnabled(false);
    vi.advanceTimersByTime(2000);
    expect(session.getSnapshot().elapsedMs).toBe(1000);
    session.setEnabled(true);
    setGamesForeground(false);
    vi.advanceTimersByTime(1000);
    setGamesForeground(true);
    vi.advanceTimersByTime(500);
    expect(session.getSnapshot().elapsedMs).toBe(1500);
    expect(record).not.toHaveBeenCalled();
    const checkpoint = {
      ...session.getSnapshot().data,
      base: applyMove(createCube(3), turn),
      moves: [],
      cursor: 0,
      started: false,
      elapsedMs: 0,
    };
    const solvable = setup(checkpoint);
    await solvable.session.load();
    solvable.session.restore();
    solvable.session.turn(inverseMove(turn));
    await settle();
    expect(solvable.session.getSnapshot().data.completed).toBe(true);
    expect(solvable.record).toHaveBeenCalledTimes(1);
    solvable.session.turn(turn);
    await settle();
    expect(solvable.record).toHaveBeenCalledTimes(1);
  });

  it("切阶使旧动画和排队操作失效，释放后不再保存", async () => {
    let finish = () => {};

    const { session, storage } = setup(
      undefined,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await session.load();
    session.turn(turn);
    session.turn(turn);
    session.newCube(2);
    finish();
    await settle();
    expect(session.getSnapshot().cube).toEqual(createCube(2));
    expect(session.getSnapshot().busy).toBe(false);
    session.dispose();
    const writes = vi.mocked(storage.write).mock.calls.length;
    session.save();
    session.turn(turn);
    expect(storage.write).toHaveBeenCalledTimes(writes);
  });

  it("挑战记录写入失败可重试，成功后不会重复结算", async () => {
    const initial = setup();
    await initial.session.load();
    const checkpoint = {
      ...initial.session.getSnapshot().data,
      challenge: true,
      base: applyMove(createCube(3), turn),
    };
    const { session, record } = setup(checkpoint);
    await session.load();
    session.restore();
    record.mockImplementationOnce(() => {
      throw new Error("history unavailable");
    });
    session.turn(inverseMove(turn));
    await settle();
    expect(session.getSnapshot().data.completed).toBe(true);
    expect(session.getSnapshot().error?.code).toBe("magic-cube:history");
    session.save();
    await settle();
    expect(session.getSnapshot().error).toBeNull();
    expect(record).toHaveBeenCalledTimes(2);
    session.save();
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("存档写入失败保留已提交动作，重新保存后清除错误", async () => {
    const { session, storage } = setup();
    await session.load();
    vi.mocked(storage.write).mockRejectedValueOnce(new Error("write failed"));
    session.turn(turn);
    await settle();
    expect(session.getSnapshot().error?.code).toBe("games:checkpoint_write");
    expect(session.getSnapshot().cube).toEqual(applyMove(createCube(3), turn));
    session.save();
    await settle();
    expect(session.getSnapshot().error).toBeNull();
  });

  it("历史有界而当前局面和累计步数不会丢失", async () => {
    const { session, stored } = setup();
    await session.load();
    for (let i = 0; i < MAX_HISTORY + 3; i++) {
      session.turn(turn);
      await settle();
    }
    const { data, cube } = session.getSnapshot();
    expect(data.moves).toHaveLength(MAX_HISTORY);
    expect(data.offset + data.cursor).toBe(MAX_HISTORY + 3);
    expect(checkpointState(cubeCheckpointSchema.parse(stored()))).toEqual(cube);
  });

  it("重复小块和越界动作的存档被拒绝", async () => {
    const { session } = setup();
    await session.load();
    const data = session.getSnapshot().data;
    const duplicate = structuredClone(data);
    duplicate.base.cubies[1] = duplicate.base.cubies[0];
    expect(cubeCheckpointSchema.safeParse(duplicate).success).toBe(false);
    expect(
      cubeCheckpointSchema.safeParse({
        ...data,
        moves: [{ ...turn, layer: 6 }],
      }).success,
    ).toBe(false);
  });
});
