import { z } from "zod";

import {
  boardModeSchema,
  checkpointSchema,
  countSchema,
  seatSchema,
} from "../engine/checkpoint-schema";
import { applyAction, createInitialState } from "./rules";
import { JUNQI_GAME_ID, type JunqiState } from "./types";

const cell = countSchema.max(59);
const action = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("move"), from: cell, to: cell }),
  z.strictObject({ type: z.literal("swap"), from: cell, to: cell }),
  z.strictObject({
    type: z.literal("arrange"),
    seed: countSchema.max(0xffffffff),
  }),
  z.strictObject({ type: z.literal("ready") }),
  z.strictObject({ type: z.literal("concede") }),
]);

const openStateSchema = z.strictObject({
  variant: z.literal("open"),
  board: z
    .array(
      z
        .strictObject({
          id: z.string().max(40),
          side: seatSchema,
          kind: z.enum([
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
          ]),
        })
        .nullable(),
    )
    .length(60),
  phase: z.enum(["deployment", "playing", "finished"]),
  ready: z.tuple([z.boolean(), z.boolean()]),
  turnSeat: seatSchema,
  winner: seatSchema.nullable(),
  reason: z
    .enum(["flag", "immobilized", "concede", "repetition", "no-capture"])
    .nullable(),
  ply: countSchema,
  revision: countSchema,
  quiet: countSchema.max(100),
  positions: z.record(z.string().max(1000), countSchema.max(3)),
  lastMove: z
    .strictObject({ type: z.literal("move"), from: cell, to: cell })
    .nullable(),
  lastAction: action.nullable(),
  lastCombat: z.enum(["attacker", "defender", "both"]).nullable(),
});

const variant = z.enum(["open", "hidden", "flip"]);
const mode = boardModeSchema.options[1].extend({ variant });
const kind = openStateSchema.shape.board.element.unwrap().shape.kind;
const seed = countSchema.max(0xffffffff);
const knowledge = z.record(z.string().max(40), z.array(kind).min(1).max(12));
const hidden = openStateSchema.extend({
  variant: z.literal("hidden"),
  seed,
  flagShown: z.tuple([z.boolean(), z.boolean()]),
  knowledge: z.tuple([knowledge, knowledge]),
});
const flip = openStateSchema.extend({
  variant: z.literal("flip"),
  seed,
  revealed: z.array(z.string().max(40)).max(50),
  sides: z.tuple([seatSchema, seatSchema]).nullable(),
  lastAction: z
    .union([
      openStateSchema.shape.lastAction.unwrap(),
      z.strictObject({ type: z.literal("flip"), at: countSchema.max(59) }),
    ])
    .nullable(),
});
export const junqiStateSchema = z.discriminatedUnion("variant", [
  openStateSchema,
  hidden,
  flip,
]);

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  )
    return false;
  const left = Object.entries(a),
    right = Object.entries(b);
  return (
    Array.isArray(a) === Array.isArray(b) &&
    left.length === right.length &&
    left.every(
      ([key, value]) =>
        Object.hasOwn(b, key) &&
        sameValue(value, (b as Record<string, unknown>)[key]),
    )
  );
}

export const junqiCheckpointSchema = checkpointSchema(
  JUNQI_GAME_ID,
  mode,
  junqiStateSchema,
).refine((checkpoint) => {
  const first = checkpoint.history[0];
  if (first.variant !== checkpoint.mode.variant) return false;
  let expected: JunqiState = createInitialState(
    first.variant,
    first.variant === "open" ? 0 : first.seed,
  );
  for (let index = 0; index < checkpoint.history.length; index++) {
    const entry = checkpoint.history[index];
    if (index > 0) {
      if (!entry.lastAction) return false;
      try {
        expected = applyAction(expected, entry.lastAction, expected.turnSeat);
      } catch {
        return false;
      }
    }
    if (!sameValue(expected, entry)) return false;
  }
  return true;
});
