import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { GameRoomStatus } from "~/bindings";
import { parseGomokuMove } from "~/features/games/gomoku/onlineProtocol";
import {
  createInitialGomokuState,
  gomokuGame,
} from "~/features/games/gomoku/rules";
import type { GomokuMove, GomokuState } from "~/features/games/gomoku/types";
import { GAME_ROOM_MESSAGE, GAME_ROOM_PEER } from "~/lib/events";

import { emit, resetEvents } from "./__fixtures__/room-events";
import { installRoomMessages } from "./__fixtures__/room-i18n";
import { leftInstances, resetIpc } from "./__fixtures__/room-ipc";
import {
  exitOnlineRoom,
  onlineRoomSession,
  retainedOnlineController,
} from "./online-session-store";
import { ONLINE_PROTOCOL_VERSION } from "./protocol";
import { hashString } from "./session";

vi.mock("@tauri-apps/api/event", () => import("./__fixtures__/room-events"));
vi.mock("~/lib/ipc", () => import("./__fixtures__/room-ipc"));

const definition = {
  game: gomokuGame,
  initialState: createInitialGomokuState,
  hash: (state: GomokuState) => hashString(JSON.stringify(state)),
};
const status: GameRoomStatus = {
  instanceId: "retained-instance",
  phase: "joined",
  roomId: "room",
  gameId: "gomoku",
  roomName: "isolated",
  host: "127.0.0.1",
  port: 27183,
  seat: 1,
  playerName: "local",
  peerName: "peer",
  hasCode: false,
  code: null,
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  installRoomMessages();
  resetEvents();
  resetIpc();
});

afterEach(async () => {
  await exitOnlineRoom("retained-test");
  await tick();
});

it("房间就绪即消费协议，页面脱离只解绑表现而不退出房间", async () => {
  const room = onlineRoomSession("retained-test", definition);
  room.activate();
  await room.owner.start(parseGomokuMove, async () => status);
  const transport = room.owner.getSnapshot().ready!.session;
  const controller = retainedOnlineController<
    GomokuState,
    GomokuMove,
    GomokuMove
  >(transport);
  const present = vi.fn();
  const detach = controller.attachPresentation(present);
  detach();
  const move = { row: 7, col: 7 };
  const next = await gomokuGame.applyMove(createInitialGomokuState(), move, 0);
  emit(GAME_ROOM_MESSAGE, {
    instanceId: status.instanceId,
    payload: JSON.stringify({
      v: ONLINE_PROTOCOL_VERSION,
      t: "move",
      move: {
        round: 0,
        revision: 0,
        seq: 0,
        seat: 0,
        move,
        stateHash: definition.hash(next.state),
      },
    }),
  });
  await tick();
  expect(
    controller.getSnapshot().match.runner.getSnapshot().state.moveCount,
  ).toBe(1);
  expect(present).not.toHaveBeenCalled();
  expect(leftInstances).toEqual([]);
  expect(onlineRoomSession("retained-test", definition)).toBe(room);
  expect(retainedOnlineController(transport)).toBe(controller);
});

it("后台断线保持真实结束状态，回页不自动重建连接或重放走法", async () => {
  const room = onlineRoomSession("retained-test", definition);
  room.activate();
  await room.owner.start(parseGomokuMove, async () => status);
  const transport = room.owner.getSnapshot().ready!.session;
  const controller = retainedOnlineController<
    GomokuState,
    GomokuMove,
    GomokuMove
  >(transport);
  emit(GAME_ROOM_PEER, { instanceId: status.instanceId, connected: false });
  await tick();
  expect(controller.getSnapshot().end).toBe("peer-left");
  expect(retainedOnlineController(transport)).toBe(controller);
});
