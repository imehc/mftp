import { z } from "zod";

import type { RemoteMove } from "../transport";

const index = z.number().int().nonnegative().safe();
export const ONLINE_PROTOCOL_VERSION = 2;
// 旧客户端不能理解代次与协商身份，使用后端已有的游戏匹配边界隔离。
export const onlineGameId = (gameId: string) =>
  `${gameId}/online-v${ONLINE_PROTOCOL_VERSION}`;
const generation = { round: index, revision: index };
const request = {
  v: z.literal(ONLINE_PROTOCOL_VERSION),
  ...generation,
  requestId: index.positive(),
  atMove: index,
  stateHash: z.string().min(1).max(64),
};
const undo = { ...request, plies: index.positive() };
const controlSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("undo-request"), ...undo }),
  z.object({ t: z.literal("undo-response"), accept: z.boolean(), ...undo }),
  z.object({ t: z.literal("rematch-request"), ...request }),
  z.object({
    t: z.literal("rematch-response"),
    accept: z.boolean(),
    ...request,
  }),
]);
const moveSchema = z.object({
  v: z.literal(ONLINE_PROTOCOL_VERSION),
  t: z.literal("move"),
  move: z.object({
    ...generation,
    seq: index,
    seat: z.union([z.literal(0), z.literal(1)]),
    stateHash: z.string().min(1).max(64),
    move: z.unknown(),
  }),
});

// 按消息类型直接分派，避免正常落子帧先产生控制消息校验错误。
const frameSchema = z.discriminatedUnion("t", [
  ...controlSchema.options,
  moveSchema,
]);

/** 游戏内部协议；Tauri 命令和事件类型仍由 Rust 生成。 */
export type MatchControlMessage = z.infer<typeof controlSchema>;

export type AppFrame<M> =
  | { v: typeof ONLINE_PROTOCOL_VERSION; t: "move"; move: RemoteMove<M> }
  | MatchControlMessage;

export type MoveParser<M> = (value: unknown) => M | null;

export function parseFrame<M>(
  raw: string,
  parseMove: MoveParser<M>,
): AppFrame<M> | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = frameSchema.safeParse(value);
  if (!parsed.success) return null;
  const message = parsed.data;
  if (message.t !== "move") {
    if ("plies" in message && message.plies > message.atMove) return null;
    return message;
  }
  const move = parseMove(message.move.move);
  if (move === null) return null;
  return {
    v: ONLINE_PROTOCOL_VERSION,
    t: "move",
    move: { ...message.move, move },
  };
}
