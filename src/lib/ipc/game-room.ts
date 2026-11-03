import {
  type AppError,
  commands,
  type GamePartyStatus,
  type GameRoomStatus,
} from "~/bindings";
import { unwrapCommand, voidCommand } from "~/lib/ipc-result";

import {
  nextPartySequence,
  queuePartyOperation,
  releasePartyRuntime,
} from "./game-party-runtime";

interface Identity {
  roomId: string;
  rulesVersion: number;
}

// 迁移期双人视图保留业务协议；运行期只缓存信封身份，不保存房间凭据。
const identities = new Map<string, Identity>();

function project(status: GamePartyStatus): GameRoomStatus {
  identities.set(status.instanceId, {
    roomId: status.roomId,
    rulesVersion: status.rulesVersion,
  });
  const peer = status.members.find(
    (member) => member.seat !== status.seat && member.connected,
  );
  const self = status.members.find((member) => member.seat === status.seat);
  return {
    instanceId: status.instanceId,
    phase: status.hosting ? "hosting" : "joined",
    roomId: status.roomId,
    gameId: status.gameId,
    roomName: status.roomName,
    host: status.host,
    port: status.port,
    seat: status.seat,
    playerName: self?.name ?? null,
    peerName: peer?.name ?? null,
    hasCode: status.code !== null,
    code: status.code,
  };
}

export async function gameRoomStatus() {
  const status = await unwrapCommand(commands.gamePartyStatus());
  return status ? project(status) : unwrapCommand(commands.gameRoomStatus());
}

export async function gameRoomCreate(
  gameId: string,
  roomName: string,
  code: string | null,
  playerName: string,
) {
  return project(
    await unwrapCommand(
      commands.gamePartyCreate({
        gameId,
        rulesVersion: 1,
        seatCount: 2,
        remoteSeats: [1],
        roomName,
        code,
        playerName,
      }),
    ),
  );
}

export async function gameRoomJoin(
  host: string,
  port: number,
  gameId: string,
  code: string | null,
  playerName: string,
) {
  return project(
    await unwrapCommand(
      commands.gamePartyJoin({
        host,
        port,
        gameId,
        rulesVersion: 1,
        code,
        playerName,
      }),
    ),
  );
}

export const gameRoomDiscover = (gameId: string) =>
  unwrapCommand(commands.gameRoomDiscover(gameId));

export async function gameRoomSend(instanceId: string, payload: string) {
  if (!identities.has(instanceId)) await gameRoomStatus();
  const identity = identities.get(instanceId);
  if (!identity)
    throw {
      kind: "custom",
      code: "room:not_joined",
      message: "Room runtime is no longer available",
      args: {},
    } satisfies AppError;
  await queuePartyOperation(instanceId, () =>
    voidCommand(
      commands.gamePartySend(instanceId, null, {
        protocolVersion: 3,
        roomId: identity.roomId,
        matchId: identity.roomId,
        rulesVersion: identity.rulesVersion,
        generation: 1,
        revision: 0,
        sequence: nextPartySequence(instanceId),
        actionId: crypto.randomUUID(),
        kind: "request",
        payload,
      }),
    ),
  );
}

export async function gameRoomLeave(instanceId: string) {
  await voidCommand(commands.gameRoomLeave(instanceId));
  identities.delete(instanceId);
  releasePartyRuntime(instanceId);
}
