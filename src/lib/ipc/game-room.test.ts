import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GamePartyStatus } from "~/bindings";

import { releasePartyRuntime } from "./game-party-runtime";
import {
  gameRoomCreate,
  gameRoomJoin,
  gameRoomLeave,
  gameRoomSend,
  gameRoomStatus,
} from "./game-room";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  join: vi.fn(),
  send: vi.fn(),
  leave: vi.fn(),
  status: vi.fn(),
  legacyStatus: vi.fn(),
}));
vi.mock("~/bindings", () => ({
  commands: {
    gamePartyCreate: mocks.create,
    gamePartyJoin: mocks.join,
    gamePartySend: mocks.send,
    gameRoomLeave: mocks.leave,
    gamePartyStatus: mocks.status,
    gameRoomStatus: mocks.legacyStatus,
  },
}));

const status: GamePartyStatus = {
  instanceId: "bridge-instance",
  protocolVersion: 3,
  roomId: crypto.randomUUID(),
  gameId: "junqi",
  rulesVersion: 1,
  seatCount: 2,
  roomName: "测试房间",
  host: "127.0.0.1",
  port: 1234,
  hosting: true,
  memberId: "host",
  seat: 0,
  code: "share-code",
  connected: true,
  connectionGeneration: 0,
  members: [
    {
      memberId: "host",
      seat: 0,
      name: "本方",
      connected: true,
      connectionGeneration: 0,
    },
    {
      memberId: "guest",
      seat: 1,
      name: "对方",
      connected: true,
      connectionGeneration: 1,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  releasePartyRuntime(status.instanceId);
  mocks.create.mockResolvedValue({ status: "ok", data: status });
  mocks.status.mockResolvedValue({ status: "ok", data: status });
  mocks.send.mockResolvedValue({ status: "ok", data: null });
  mocks.leave.mockResolvedValue({ status: "ok", data: null });
});

describe("现有双人对局接入成员传输", () => {
  it("创建与加入统一走多人命令，原有双人状态按本方座位投影", async () => {
    const host = await gameRoomCreate(
      "junqi",
      "测试房间",
      "share-code",
      "本方",
    );
    expect(mocks.create).toHaveBeenCalledWith({
      gameId: "junqi",
      rulesVersion: 1,
      seatCount: 2,
      remoteSeats: [1],
      roomName: "测试房间",
      code: "share-code",
      playerName: "本方",
    });
    expect(host).toMatchObject({
      phase: "hosting",
      seat: 0,
      playerName: "本方",
      peerName: "对方",
      hasCode: true,
    });
    mocks.join.mockResolvedValueOnce({
      status: "ok",
      data: {
        ...status,
        hosting: false,
        memberId: "guest",
        seat: 1,
        code: null,
      },
    });
    expect(
      await gameRoomJoin("127.0.0.1", 1234, "junqi", "share-code", "对方"),
    ).toMatchObject({
      phase: "joined",
      seat: 1,
      playerName: "对方",
      peerName: "本方",
      code: null,
    });
  });

  it("军棋私有业务帧和棋类锁步消息原样传输，并发发送保持唯一递增序号", async () => {
    await gameRoomStatus();
    const payloads = [
      JSON.stringify({
        t: "authority-v2",
        observation: { ownPieces: ["工兵"], opponent: ["未知"] },
      }),
      JSON.stringify({ t: "move", move: { row: 2, col: 3 } }),
    ];
    await Promise.all(
      payloads.map((payload) => gameRoomSend(status.instanceId, payload)),
    );
    expect(mocks.send.mock.calls.map((args) => args[2].sequence)).toEqual([
      1, 2,
    ]);
    expect(mocks.send.mock.calls.map((args) => args[2].payload)).toEqual(
      payloads,
    );
    expect(
      mocks.send.mock.calls.every(
        (args) =>
          args[1] === null &&
          args[2].kind === "request" &&
          args[2].roomId === status.roomId,
      ),
    ).toBe(true);
    expect(JSON.stringify(mocks.send.mock.calls)).not.toContain("share-code");
    await gameRoomStatus();
    await gameRoomSend(status.instanceId, "{}");
    expect(mocks.send.mock.calls.at(-1)?.[2].sequence).toBe(3);
  });

  it("离开失败保留可重试身份，成功后清理，旧实例不能误发到新房间", async () => {
    await gameRoomStatus();
    const error = {
      kind: "custom",
      code: "room:not_joined",
      message: "Isolated failure",
      args: {},
    };
    mocks.leave.mockResolvedValueOnce({ status: "error", error });
    await expect(gameRoomLeave(status.instanceId)).rejects.toMatchObject({
      payload: error,
    });
    await gameRoomSend(status.instanceId, "{}");
    await gameRoomLeave(status.instanceId);
    mocks.status.mockResolvedValue({
      status: "ok",
      data: { ...status, instanceId: "replacement" },
    });
    await expect(gameRoomSend(status.instanceId, "{}")).rejects.toMatchObject({
      code: "room:not_joined",
    });
  });
});
