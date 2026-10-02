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

test("malformed envelopes and controls are ignored without throwing", () => {
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

test("all current control frames and move envelopes retain their wire values", () => {
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

test("each game validates integral coordinates against its own board", () => {
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

test("partial registration failure cleans successful and late listeners", async () => {
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

test("aborting registration returns promptly and cleans late completions", async () => {
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

test("closing is idempotent and callbacks already queued by the bridge are inert", async () => {
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

test("a cleanup exception cannot prevent other listeners from being released", async () => {
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

test("queued moves and controls drain once in common arrival order", async () => {
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

test("asynchronous Tauri unlisten rejections are handled", async () => {
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

test("messages arriving during listener registration wait for their consumer", async () => {
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

test("presence and closure received before consumer mounting are replayed", async () => {
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

test("buffer overflow terminates local delivery without canceling the backend", async () => {
  const session = await createSession(status, parseGomokuMove);
  for (let index = 0; index < 129; index++) emit(GAME_ROOM_MESSAGE, rawMove);
  expect(session.isClosed).toBe(true);
  const closed: string[] = [];
  session.onClosed((reason) => closed.push(reason));
  expect(closed).toStrictEqual(["connection-lost"]);
  expect(leaves).toBe(0);
});

test("invalid frames do not reach consumers or prevent the next valid move", async () => {
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

test("sending keeps the existing move and control JSON shapes", async () => {
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

test("closed-session diagnostics use the active locale", async () => {
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
