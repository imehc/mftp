import { beforeEach, expect, test, vi } from "vitest";
import { installRoomMessages } from "./__fixtures__/room-i18n";
import type { GameRoomStatus } from "~/bindings";
import { RoomOwner } from "./roomOwner";
import { OnlineMatchSession } from "./session";
import { ONLINE_PROTOCOL_VERSION } from "./protocol";
import { discoverRooms } from "./discovery";
import { parseGomokuMove } from "~/features/games/gomoku/onlineProtocol";
import {
  GAME_ROOM_CLOSED,
  GAME_ROOM_MESSAGE,
  GAME_ROOM_PEER,
} from "~/lib/events";
import { emit, registrations, resetEvents } from "./__fixtures__/room-events";
import {
  leftInstances,
  onDiscover,
  onLeave,
  resetIpc,
  sentInstances,
} from "./__fixtures__/room-ipc";

// 用可观测的 stub 替换 Tauri 事件与 IPC 出口：注册/解除时序、发送与退出的
// 实例标识都要被断言，真实实现无法提供这些观察点。
vi.mock("@tauri-apps/api/event", () => import("./__fixtures__/room-events"));
vi.mock("~/lib/ipc", () => import("./__fixtures__/room-ipc"));

// 每个用例都从干净的监听表和 IPC 计数开始，断言才能比对确切的实例序列。
beforeEach(() => {
  installRoomMessages();
  resetEvents();
  resetIpc();
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function status(instanceId: string, hosting = false): GameRoomStatus {
  return {
    instanceId,
    phase: hosting ? "hosting" : "joined",
    roomId: "same-remote-room",
    gameId: "gomoku",
    roomName: "test",
    host: "127.0.0.1",
    port: 27183,
    seat: hosting ? 0 : 1,
    playerName: "local",
    peerName: hosting ? null : "peer",
    hasCode: false,
    code: null,
  };
}
function owner() {
  const value = new RoomOwner<
    NonNullable<ReturnType<typeof parseGomokuMove>>
  >();
  value.activate();
  return value;
}
const frame = {
  v: ONLINE_PROTOCOL_VERSION,
  t: "move",
  move: {
    round: 0,
    revision: 0,
    seq: 0,
    seat: 0,
    stateHash: "board",
    move: { row: 0, col: 1 },
  },
};
const failure = {
  kind: "external",
  code: "runtime:operation",
  message: "bridge failed",
  args: { operation: "listen" },
};

test("open waits for all subscriptions; duplicate clicks cannot start another request", async () => {
  resetEvents(false);
  const room = owner();
  let calls = 0;
  const open = async () => {
    calls++;
    return status("one");
  };
  const first = room.start(parseGomokuMove, open);
  await room.start(parseGomokuMove, open);
  await tick();
  expect(calls).toBe(0);
  registrations[0].resolve();
  registrations[1].resolve();
  await tick();
  expect(calls).toBe(0);
  registrations[2].resolve();
  await first;
  expect(calls).toBe(1);
  expect(room.getSnapshot().ready?.status.instanceId).toBe("one");
  await room.cancel();
});

test("registration failure preserves the full error and never opens or leaves a room", async () => {
  resetEvents(false);
  const room = owner();
  let calls = 0;
  const starting = room.start(parseGomokuMove, async () => {
    calls++;
    return status("one");
  });
  await tick();
  registrations[0].resolve();
  registrations[1].reject(failure);
  await starting;
  registrations[2].resolve();
  await tick();
  expect(room.getSnapshot().error).toStrictEqual(failure);
  expect(calls).toBe(0);
  expect(leftInstances).toStrictEqual([]);
  room.dispose();
});

test("cancellation during registration cleans late listeners without invoking the backend", async () => {
  resetEvents(false);
  const room = owner();
  let calls = 0;
  const starting = room.start(parseGomokuMove, async () => {
    calls++;
    return status("one");
  });
  await tick();
  await room.cancel();
  await starting;
  for (const registration of registrations) registration.resolve();
  await tick();
  expect(calls).toBe(0);
  expect(registrations.every((entry) => entry.cleaned === 1)).toBeTruthy();
  expect(leftInstances).toStrictEqual([]);
});

test("late open and real cleanup finish before the next owner starts", async () => {
  const first = owner();
  const second = owner();
  const opening = deferred<GameRoomStatus>();
  const leaving = deferred<void>();
  onLeave(async (id) => {
    if (id === "old") await leaving.promise;
  });
  const startFirst = first.start(parseGomokuMove, () => opening.promise);
  await tick();
  first.dispose();
  let openedSecond = false;
  const startSecond = second.start(parseGomokuMove, async () => {
    openedSecond = true;
    return status("new");
  });
  opening.resolve(status("old"));
  await tick();
  expect(leftInstances).toStrictEqual(["old"]);
  expect(openedSecond).toBe(false);
  expect(first.getSnapshot().ready).toBe(null);
  leaving.resolve();
  await Promise.all([startFirst, startSecond]);
  expect(second.getSnapshot().ready?.status.instanceId).toBe("new");
  first.dispose();
  await tick();
  expect(leftInstances).toStrictEqual(["old"]);
  await second.cancel();
  expect(leftInstances).toStrictEqual(["old", "new"]);
});

test("peer and first move before IPC returns survive the handoff; stale events do not", async () => {
  const room = owner();
  await room.start(parseGomokuMove, async () => {
    emit(GAME_ROOM_CLOSED, { instanceId: "old", reason: "closed" });
    emit(GAME_ROOM_MESSAGE, {
      instanceId: "old",
      payload: JSON.stringify(frame),
    });
    emit(GAME_ROOM_PEER, {
      instanceId: "host",
      connected: true,
      name: "early guest",
    });
    emit(GAME_ROOM_MESSAGE, {
      instanceId: "host",
      payload: JSON.stringify(frame),
    });
    return status("host", true);
  });
  const ready = room.getSnapshot().ready!;
  expect(ready.status.peerName).toBe("early guest");
  const moves: unknown[] = [];
  ready.session.onRemoteMove((move) => moves.push(move));
  expect(moves).toStrictEqual([frame.move]);
  emit(GAME_ROOM_CLOSED, { instanceId: "old", reason: "closed" });
  expect(ready.session.isClosed).toBe(false);
  await ready.session.sendControl({
    v: ONLINE_PROTOCOL_VERSION,
    round: 0,
    revision: 0,
    t: "rematch-request",
    requestId: 1,
    atMove: 0,
    stateHash: "board",
  });
  expect(sentInstances).toStrictEqual(["host"]);
  await room.cancel();
});

test("a terminal event before open resolves prevents a dead room handoff", async () => {
  const room = owner();
  await room.start(parseGomokuMove, async () => {
    emit(GAME_ROOM_CLOSED, { instanceId: "dead", reason: "peer-left" });
    return status("dead");
  });
  expect(room.getSnapshot().ready).toBe(null);
  expect(room.getSnapshot().error).toBeTruthy();
  expect(leftInstances).toStrictEqual(["dead"]);
});

test("replacing a ready owner closes its listeners and stale cleanup cannot leave the replacement", async () => {
  const first = owner();
  await first.start(parseGomokuMove, async () => status("one"));
  const oldSession = first.getSnapshot().ready!.session;
  const lateCallbacks = registrations.slice();
  const second = owner();
  await second.start(parseGomokuMove, async () => status("two"));
  expect(oldSession.isClosed).toBe(true);
  expect(leftInstances).toStrictEqual(["one"]);
  first.dispose();
  for (const registration of lateCallbacks)
    registration.callback({
      event: registration.topic,
      id: 0,
      payload: { instanceId: "one", reason: "closed" },
    });
  await tick();
  expect(second.getSnapshot().ready?.session.isClosed).toBe(false);
  expect(leftInstances).toStrictEqual(["one"]);
  // 无需等待 React 的下一次 effect，就能释放刚刚交接的实例。
  second.dispose();
  await tick();
  expect(leftInstances).toStrictEqual(["one", "two"]);
});

test("StrictMode setup-cleanup-setup does not leave an unowned room or revive old work", async () => {
  const room = owner();
  room.dispose();
  room.activate();
  expect(leftInstances).toStrictEqual([]);
  const opening = deferred<GameRoomStatus>();
  const starting = room.start(parseGomokuMove, () => opening.promise);
  await tick();
  room.dispose();
  room.activate();
  opening.resolve(status("old"));
  await starting;
  await tick();
  expect(room.getSnapshot().ready).toBe(null);
  await room.start(parseGomokuMove, async () => status("new"));
  expect(room.getSnapshot().ready?.status.instanceId).toBe("new");
  await room.cancel();
});

test("cleanup failure is visible and retained for retry before another open", async () => {
  const room = owner();
  await room.start(parseGomokuMove, async () => status("one"));
  onLeave(async () => {
    throw failure;
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await room.cancel();
    expect(room.getSnapshot().error).toStrictEqual(failure);
    let calls = 0;
    await room.start(parseGomokuMove, async () => {
      calls++;
      return status("two");
    });
    expect(calls).toBe(0);
    expect(room.getSnapshot().error).toStrictEqual(failure);
    onLeave(async () => {});
    await room.start(parseGomokuMove, async () => {
      calls++;
      return status("two");
    });
    expect(calls).toBe(1);
    await room.cancel();
  } finally {
    console.warn = warn;
  }
  expect(leftInstances).toStrictEqual(["one", "one", "one", "two"]);
});

test("open errors never hand off stale status and allow retry", async () => {
  const room = owner();
  await room.start(parseGomokuMove, async () => {
    throw failure;
  });
  expect(room.getSnapshot().ready).toBe(null);
  expect(room.getSnapshot().error).toStrictEqual(failure);
  expect(leftInstances).toStrictEqual([]);
  await room.start(parseGomokuMove, async () => status("retry"));
  expect(room.getSnapshot().ready?.status.instanceId).toBe("retry");
  await room.cancel();
});

test("a waiting host hands off only its own presence and repeated cancel shares cleanup", async () => {
  const room = owner();
  await room.start(parseGomokuMove, async () => status("host", true));
  expect(room.getSnapshot().hosting?.instanceId).toBe("host");
  emit(GAME_ROOM_PEER, { instanceId: "old", connected: true, name: "stale" });
  expect(room.getSnapshot().ready).toBe(null);
  emit(GAME_ROOM_PEER, { instanceId: "host", connected: true, name: "guest" });
  expect(room.getSnapshot().ready?.status.peerName).toBe("guest");
  const leaving = deferred<void>();
  onLeave(() => leaving.promise);
  const first = room.cancel();
  const second = room.cancel();
  expect(first).toBe(second);
  await tick();
  expect(room.getSnapshot().cancelling).toBe(true);
  expect(leftInstances).toStrictEqual(["host"]);
  leaving.resolve();
  await first;
  expect(room.getSnapshot().cancelling).toBe(false);
});

test("effect reconnection never reuses a session already closed by cleanup", async () => {
  const room = owner();
  await room.start(parseGomokuMove, async () => status("one"));
  room.dispose();
  room.activate();
  expect(room.getSnapshot().ready).toBe(null);
  await tick();
  expect(room.getSnapshot().busy).toBe(false);
  await room.start(parseGomokuMove, async () => status("two"));
  expect(room.getSnapshot().ready?.status.instanceId).toBe("two");
  await room.cancel();
  expect(leftInstances).toStrictEqual(["one", "two"]);
});

test("unbound event buffering is bounded and cannot silently lose the first move", async () => {
  const session = await OnlineMatchSession.prepare(parseGomokuMove);
  for (let i = 0; i < 129; i++)
    emit(GAME_ROOM_MESSAGE, {
      instanceId: "one",
      payload: JSON.stringify(frame),
    });
  expect(session.isClosed).toBe(true);
  expect(() => session.bind(status("one"))).toThrowError(
    expect.objectContaining({ name: "AbortError" }),
  );
});

test("discovery reuses an in-flight scan and serializes different games without swallowing errors", async () => {
  const first = deferred<[]>();
  const calls: string[] = [];
  onDiscover((game) => {
    calls.push(game);
    return game === "gomoku" ? first.promise : Promise.resolve([]);
  });
  const one = discoverRooms("gomoku");
  const duplicate = discoverRooms("gomoku");
  const other = discoverRooms("go-9");
  expect(calls).toStrictEqual(["gomoku"]);
  const rejected = Promise.all([
    expect(one).rejects.toSatisfy((error) => error === failure),
    expect(duplicate).rejects.toSatisfy((error) => error === failure),
  ]);
  first.reject(failure);
  await rejected;
  expect(await other).toStrictEqual([]);
  expect(calls).toStrictEqual(["gomoku", "go-9"]);
});
