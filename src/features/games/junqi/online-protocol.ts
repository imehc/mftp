import { z } from "zod";

import { countSchema, seatSchema } from "../engine/checkpoint-schema";
import { JUNQI_GAME_ID, type JunqiVariant } from "./types";

const index = countSchema.safe();
const cell = index.max(59);
const id = z.string().min(1).max(80);
const variant = z.enum(["open", "hidden", "flip"]);
const kind = z.enum([
  "commander",
  "general",
  "division",
  "brigade",
  "regiment",
  "battalion",
  "company",
  "platoon",
  "engineer",
  "bomb",
  "mine",
  "flag",
]);
const step = z.strictObject({ type: z.literal("move"), from: cell, to: cell });
const piece = z.discriminatedUnion("face", [
  z.strictObject({ id, face: z.literal("known"), side: seatSchema, kind }),
  z.strictObject({
    id,
    face: z.literal("covered"),
    side: seatSchema.nullable(),
  }),
]);

export const junqiViewSchema = z.strictObject({
  variant,
  board: z.array(piece.nullable()).length(60),
  phase: z.enum(["deployment", "playing", "finished"]),
  turnSeat: seatSchema,
  turnSide: seatSchema.nullable(),
  viewerSide: seatSchema.nullable(),
  winner: seatSchema.nullable(),
  reason: z
    .enum(["flag", "immobilized", "concede", "repetition", "no-capture"])
    .nullable(),
  ply: index,
  revision: index,
  lastMove: step.nullable(),
  lastCombat: z.enum(["attacker", "defender", "both"]).nullable(),
  candidates: z.record(id, z.array(kind).min(1).max(12)),
});

// 随机布阵的种子只在裁判内部生成；网络动作不接受种子或座位声明。
export const junqiIntentSchema = z.discriminatedUnion("type", [
  step,
  z.strictObject({ type: z.literal("swap"), from: cell, to: cell }),
  z.strictObject({ type: z.literal("arrange") }),
  z.strictObject({ type: z.literal("ready") }),
  z.strictObject({ type: z.literal("flip"), at: cell }),
  z.strictObject({ type: z.literal("concede") }),
]);

const envelope = { v: z.literal(1), matchId: id, round: index };
const request = { ...envelope, requestId: index.positive(), revision: index };
export const junqiFrameSchema = z.discriminatedUnion("t", [
  z.strictObject({ v: z.literal(1), t: z.literal("hello"), variant }),
  z.strictObject({ t: z.literal("sync"), ...envelope }),
  z.strictObject({
    t: z.literal("action"),
    ...request,
    action: junqiIntentSchema,
  }),
  z.strictObject({
    t: z.literal("state"),
    ...envelope,
    acceptedRequest: index.nullable(),
    undoDepth: index.max(100),
    view: junqiViewSchema,
  }),
  z.strictObject({
    t: z.literal("reject"),
    ...request,
    reason: z.enum(["stale", "illegal"]),
  }),
  z.strictObject({ t: z.literal("rematch-request"), ...request }),
  z.strictObject({
    t: z.literal("undo-request"),
    ...request,
    plies: z.union([z.literal(1), z.literal(2)]),
  }),
  z.strictObject({
    t: z.literal("undo-response"),
    ...request,
    plies: z.union([z.literal(1), z.literal(2)]),
    accept: z.boolean(),
  }),
  z.strictObject({
    t: z.literal("rematch-response"),
    ...request,
    accept: z.boolean(),
  }),
]);

export type JunqiIntent = z.infer<typeof junqiIntentSchema>;

export type JunqiFrame = z.infer<typeof junqiFrameSchema>;

export function parseJunqiFrame(value: unknown): JunqiFrame | null {
  const result = junqiFrameSchema.safeParse(value);
  return result.success ? result.data : null;
}

export const junqiRoomGameId = (variant: JunqiVariant) =>
  `${JUNQI_GAME_ID}/${variant}/authority-v2`;
