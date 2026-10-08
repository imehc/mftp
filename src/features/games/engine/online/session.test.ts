import { beforeEach, expect, test, vi } from "vitest";
import { i18n } from "@lingui/core";
import type { GameRoomStatus } from "~/types";
import {
  GAME_ROOM_CLOSED,
  GAME_ROOM_MESSAGE,
  GAME_ROOM_PEER,
} from "~/lib/events";
import { OnlineMatchSession, hashString } from "./session";
import {
  ONLINE_PROTOCOL_VERSION,
  parseFrame,
  type MatchControlMessage,
} from "./protocol";
import { parseGomokuMove } from "~/features/games/gomoku/onlineProtocol";
import { goMoveParser } from "~/features/games/go/onlineProtocol";
import { parseXiangqiMove } from "~/features/games/xiangqi/onlineProtocol";
import {
  emit as emitRaw,
  registrations,
  resetEvents,
} from "./__fixtures__/room-events";
import { installRoomMessages } from "./__fixtures__/room-i18n";
import { leaves, resetIpc, sent } from "./__fixtures__/room-ipc";

// 用可观测的 stub 替换 Tauri 事件与 IPC 出口：注册/解除时序、发送与退出的
// 实例标识都要被断言，真实实现无法提供这些观察点。
vi.mock("@tauri-apps/api/event", () => import("./__fixtures__/room-events"));
vi.mock("~/lib/ipc", () => import("./__fixtures__/room-ipc"));

const status: GameRoomStatus = {
  instanceId: "instance",
  phase: "joined",
  roomId: "room",
  gameId: "gomoku",
  roomName: "test",
  host: "127.0.0.1",
  port: 27183,
  seat: 1,
  playerName: "guest",
  peerName: "host",
  hasCode: false,
  code: null,
};
// v2 走法信封：round/revision 标记对局代次，seq 只在当前修订内计数。
const move = {
  round: 0,
  revision: 0,
  seq: 0,
  seat: 0,
  move: { row: 2, col: 3 },
  stateHash: hashString("board"),
};
const rawMove = JSON.stringify({ v: ONLINE_PROTOCOL_VERSION, t: "move", move });
const gen = { v: ONLINE_PROTOCOL_VERSION, round: 0, revision: 0 } as const;
const undoRequest: MatchControlMessage = {
  ...gen,
  t: "undo-request",
  requestId: 1,
  atMove: 2,
  stateHash: hashString("x"),
  plies: 1,
};
const undoResponse: MatchControlMessage = {
  ...gen,
  t: "undo-response",
  requestId: 2,
  atMove: 2,
  stateHash: hashString("x"),
  plies: 2,
  accept: false,
};
const rematchRequest: MatchControlMessage = {
  ...gen,
  t: "rematch-request",
  requestId: 3,
  atMove: 5,
  stateHash: hashString("x"),
};
const rematchResponse: MatchControlMessage = {
  ...gen,
  t: "rematch-response",
  requestId: 4,
  atMove: 5,
  stateHash: hashString("x"),
  accept: true,
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function emit(topic: string, payload: unknown) {
  emitRaw(
    topic,
    topic === GAME_ROOM_MESSAGE
      ? { instanceId: "instance", payload }
      : { instanceId: "instance", ...(payload as object) },
  );
}
async function createSession(
  state: GameRoomStatus,
  parse: typeof parseGomokuMove,
  signal?: AbortSignal,
) {
  const session = await OnlineMatchSession.prepare(parse, signal);
  session.bind(state);
  return session;
}

beforeEach(() => {
  installRoomMessages();
  resetEvents();
  resetIpc();
});

test("忽略格式错误的信封和控制帧且不抛出异常", () => {
  for (const value of [
    null,
    [],
    true,
    1,
    "move",
    {},
    { t: "unknown" },
    // v1 旧帧缺少版本号或版本不匹配，必须被拒收。
    { t: "move", move },
    { ...undoRequest, v: 1 },
    { v: 1, t: "move", move },
    { v: ONLINE_PROTOCOL_VERSION, t: "move", move: null },
    {
      v: ONLINE_PROTOCOL_VERSION,
      t: "move",
      move: { ...move, seq: -1 },
    },
    {
      v: ONLINE_PROTOCOL_VERSION,
      t: "move",
      move: { ...move, seq: 0.5 },
    },
    {
      v: ONLINE_PROTOCOL_VERSION,
      t: "move",
      move: { ...move, seat: 2 },
    },
    {
      v: ONLINE_PROTOCOL_VERSION,
      t: "move",
      move: { ...move, round: -1 },
    },
    {
      v: ONLINE_PROTOCOL_VERSION,
      t: "move",
      move: { ...move, revision: 1.5 },
    },
    {
      v: ONLINE_PROTOCOL_VERSION,
      t: "move",
      move: { ...move, stateHash: "" },
    },
    {
      v: ONLINE_PROTOCOL_VERSION,
      t: "move",
      move: { ...move, stateHash: "x".repeat(65) },
    },
    {
      v: ONLINE_PROTOCOL_VERSION,
      t: "move",
      move: { ...move, seq: Number.MAX_SAFE_INTEGER + 1 },
    },
    { ...undoRequest, requestId: 0 },
    { ...undoRequest, plies: 0 },
    { ...undoRequest, plies: 3 },
    { ...undoResponse, accept: "yes" },
    { ...rematchResponse, accept: 1 },
  ])
    expect(
      parseFrame(JSON.stringify(value), parseGomokuMove),
      JSON.stringify(value),
    ).toBe(null);
  expect(parseFrame("{broken", parseGomokuMove)).toBe(null);
});

test("所有当前控制帧和着法信封保留线路值", () => {
  for (const value of [
    { v: ONLINE_PROTOCOL_VERSION, t: "move", move },
    undoRequest,
    undoResponse,
    rematchRequest,
    rematchResponse,
  ])
    expect(parseFrame(JSON.stringify(value), parseGomokuMove)).toStrictEqual(
      value,
    );
});

test("每个游戏都根据自身棋盘校验整数坐标", () => {
  expect(parseGomokuMove({ row: 14, col: 0 })).toStrictEqual({
    row: 14,
    col: 0,
  });
  for (const value of [
    null,
    {},
    { row: 15, col: 0 },
    { row: 1.1, col: 0 },
    { row: 0, col: "1" },
  ]) {
    expect(parseGomokuMove(value)).toBe(null);
  }
  for (const size of [9, 13, 19] as const) {
    const parseGo = goMoveParser(size);
    expect(parseGo({ kind: "play", row: size - 1, col: 0 })).toStrictEqual({
      kind: "play",
      row: size - 1,
      col: 0,
    });
    expect(parseGo({ kind: "pass" })).toStrictEqual({ kind: "pass" });
    expect(parseGo({ kind: "play", row: size, col: 0 })).toBe(null);
    expect(parseGo({ kind: "play", row: 0, col: -1 })).toBe(null);
    expect(parseGo({ kind: "other" })).toBe(null);
  }
  expect(parseXiangqiMove({ from: 0, to: 89 })).toStrictEqual({
    from: 0,
    to: 89,
  });
  for (const value of [
    { from: 90, to: 0 },
    { from: 0, to: 0 },
    { from: -1, to: 0 },
    { from: 0, to: 1.5 },
  ]) {
    expect(parseXiangqiMove(value)).toBe(null);
  }
  expect(
    parseFrame(
      JSON.stringify({
        v: ONLINE_PROTOCOL_VERSION,
        t: "move",
        move: { ...move, move: { row: 999, col: 0 } },
      }),
      parseGomokuMove,
    ),
  ).toBe(null);
});

test("部分注册失败时清理已成功和延迟完成的监听器", async () => {
  resetEvents(false);
  const attempt = createSession(status, parseGomokuMove);
  await tick();
  const error = {
    kind: "external",
    code: "runtime:operation",
    message: "registration failed",
    args: {},
  };
  registrations[0].resolve();
  await tick();
  registrations[1].reject(error);
  await expect(attempt).rejects.toSatisfy((value) => value === error);
  expect(registrations[0].cleaned).toBe(1);
  expect(registrations[2].cleaned).toBe(0);
  registrations[2].resolve();
  await tick();
  expect(registrations[2].cleaned).toBe(1);
  expect(registrations.every((entry) => !entry.active)).toBeTruthy();
  expect(leaves).toBe(0);
});

test("中止注册会及时返回并清理延迟完成项", async () => {
  resetEvents(false);
  const controller = new AbortController();
  const attempt = createSession(status, parseGomokuMove, controller.signal);
  await tick();
  controller.abort();
  await expect(attempt).rejects.toMatchObject({ name: "AbortError" });
  for (const registration of registrations) registration.resolve();
  await tick();
  expect(registrations.every((entry) => entry.cleaned === 1)).toBeTruthy();
  resetEvents();
  await expect(
    createSession(status, parseGomokuMove, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(registrations.length).toBe(0);
});

test("关闭操作幂等，桥接层已排队的回调不会产生作用", async () => {
  const session = await createSession(status, parseGomokuMove);
  let moves = 0;
  session.onRemoteMove(() => moves++);
  const late = registrations.find(
    (entry) => entry.topic === GAME_ROOM_MESSAGE,
  )!.callback;
  session.close();
  session.close();
  late({ event: GAME_ROOM_MESSAGE, id: 0, payload: rawMove });
  expect(moves).toBe(0);
  expect(registrations.every((entry) => entry.cleaned === 1)).toBeTruthy();
  await expect(session.sendMove(move)).rejects.toMatchObject({
    name: "AbortError",
  });
  await expect(session.sendControl(rematchRequest)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(sent).toStrictEqual([]);
  expect(leaves).toBe(0);
});

test("清理异常不能阻止其他监听器释放", async () => {
  const session = await createSession(status, parseGomokuMove);
  registrations[0].cleanupThrows = true;
  const warn = console.warn;
  console.warn = () => {};
  try {
    session.close();
  } finally {
    console.warn = warn;
  }
  expect(registrations.every((entry) => entry.cleaned === 1)).toBeTruthy();
  emit(GAME_ROOM_MESSAGE, rawMove);
  expect(session.isClosed).toBe(true);
});

test("排队的着法和控制帧按共同到达顺序只排空一次", async () => {
  const session = await createSession(status, parseGomokuMove);
  emit(GAME_ROOM_MESSAGE, JSON.stringify(undoRequest));
  emit(GAME_ROOM_MESSAGE, rawMove);
  const received: string[] = [];
  session.onRemoteMove(() => received.push("move"));
  expect(received).toStrictEqual([]);
  const off = session.onControl(() => received.push("undo"));
  expect(received).toStrictEqual(["undo", "move"]);
  off();
  session.onControl(() => received.push("duplicate"));
  expect(received).toStrictEqual(["undo", "move"]);
  session.close();
});

test("处理异步 Tauri 取消监听的拒绝", async () => {
  const session = await createSession(status, parseGomokuMove);
  registrations[0].cleanupRejects = true;
  const warn = console.warn;
  let warnings = 0;
  console.warn = () => warnings++;
  try {
    session.close();
    await tick();
  } finally {
    console.warn = warn;
  }
  expect(warnings).toBe(1);
  expect(registrations.every((entry) => entry.cleaned === 1)).toBeTruthy();
});

test("监听器注册期间到达的消息会等待消费者", async () => {
  resetEvents(false);
  const attempt = createSession(status, parseGomokuMove);
  await tick();
  emit(GAME_ROOM_MESSAGE, rawMove);
  for (const entry of registrations) entry.resolve();
  const session = await attempt;
  const received: unknown[] = [];
  session.onRemoteMove((value) => received.push(value));
  expect(received).toStrictEqual([move]);
  session.close();
});

test("消费者挂载前收到的在线状态和关闭事件会重放", async () => {
  const session = await createSession(status, parseGomokuMove);
  emit(GAME_ROOM_PEER, { connected: false, name: null });
  const presence: boolean[] = [];
  session.onPeerPresence((value) => presence.push(value));
  expect(presence).toStrictEqual([false]);
  emit(GAME_ROOM_CLOSED, { reason: "peer-left" });
  const closed: string[] = [];
  session.onClosed((reason) => closed.push(reason));
  expect(closed).toStrictEqual(["peer-left"]);
  expect(session.isClosed).toBe(true);
  expect(registrations.every((entry) => entry.cleaned === 1)).toBeTruthy();
});

test("缓冲区溢出会终止本地投递但不取消后端", async () => {
  const session = await createSession(status, parseGomokuMove);
  for (let index = 0; index < 129; index++) emit(GAME_ROOM_MESSAGE, rawMove);
  expect(session.isClosed).toBe(true);
  const closed: string[] = [];
  session.onClosed((reason) => closed.push(reason));
  expect(closed).toStrictEqual(["connection-lost"]);
  expect(leaves).toBe(0);
});

test("无效帧不会到达消费者，也不会阻止下一次有效着法", async () => {
  const session = await createSession(status, parseGomokuMove);
  const received: unknown[] = [];
  session.onRemoteMove((value) => received.push(value));
  emit(GAME_ROOM_MESSAGE, "null");
  emit(
    GAME_ROOM_MESSAGE,
    JSON.stringify({
      v: ONLINE_PROTOCOL_VERSION,
      t: "move",
      move: { ...move, move: null },
    }),
  );
  emit(GAME_ROOM_MESSAGE, rawMove);
  expect(received).toStrictEqual([move]);
  session.close();
});

test("发送时保留现有着法和控制 JSON 结构", async () => {
  const session = await createSession(status, parseGomokuMove);
  await session.sendMove(move);
  const acceptUndo: MatchControlMessage = {
    ...undoResponse,
    accept: true,
    plies: 1,
  };
  await session.sendControl(acceptUndo);
  expect(sent.map((raw) => JSON.parse(raw))).toStrictEqual([
    { v: ONLINE_PROTOCOL_VERSION, t: "move", move },
    acceptUndo,
  ]);
  session.close();
});

test("已关闭会话的诊断使用当前语言环境", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    createSession(status, parseGomokuMove, controller.signal),
  ).rejects.toMatchObject({
    name: "AbortError",
    message: "游戏房间连接已结束，请重新加入",
  });
  i18n.activate("en");
  await expect(
    createSession(status, parseGomokuMove, controller.signal),
  ).rejects.toMatchObject({
    name: "AbortError",
    message: "The game room connection has ended. Please rejoin.",
  });
});
