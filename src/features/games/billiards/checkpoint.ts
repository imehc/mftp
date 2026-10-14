import { z } from "zod";

import {
  checkpointSchema,
  countSchema,
  difficultySchema,
  seatSchema,
} from "../engine/checkpoint-schema";
import {
  BILLIARDS_GAME_ID,
  type BilliardsMode,
  type BilliardsState,
} from "./types";

const redsSchema = z.union([z.literal(6), z.literal(10), z.literal(15)]);
const ballId = countSchema.max(22);
const ballsSchema = z
  .array(
    z.strictObject({
      id: ballId,
      x: z.number().min(-10).max(10),
      y: z.number().min(-10).max(10),
      potted: z.boolean(),
    }),
  )
  .min(1)
  .max(22)
  .refine(
    (balls) =>
      new Set(balls.map((ball) => ball.id)).size === balls.length &&
      balls.some((ball) => ball.id === 0),
  );
const pair = z.array(countSchema).length(2);
const snookerOn = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("red") }),
  z.strictObject({
    kind: z.literal("color"),
    nominated: countSchema.min(2).max(7).nullable(),
  }),
  z.strictObject({
    kind: z.literal("clearance"),
    color: countSchema.min(2).max(7),
  }),
]);
const position = {
  balls: ballsSchema,
  on: snookerOn,
  placementRegion: z.enum(["d", "table"]).nullable(),
  freeBall: z.boolean(),
  nominatedFree: ballId.nullable(),
};
const base = {
  balls: ballsSchema,
  turnSeat: seatSchema,
  breakDone: z.boolean(),
  ballInHand: z.boolean(),
  winnerSeat: seatSchema.nullable(),
  finished: z.boolean(),
  shotCount: countSchema,
  foulCounts: z.array(countSchema).min(1).max(2),
  lastOutcome: z
    .strictObject({
      foul: z
        .enum([
          "cue-potted",
          "no-contact",
          "wrong-first-contact",
          "potted-eight-early",
          "no-rail",
          "illegal-break",
          "wrong-ball-potted",
          "touching-ball-moved",
          "snooker-behind-nomination",
        ])
        .nullable(),
      potted: z.array(ballId).max(22),
      continueTurn: z.boolean(),
      respottedEight: z.boolean(),
      respottedNine: z.boolean().optional(),
    })
    .nullable(),
};

export const billiardsModeSchema: z.ZodType<BilliardsMode> = z.intersection(
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("practice") }),
    z.object({ kind: z.literal("hotseat"), firstSeat: seatSchema.optional() }),
    z.object({
      kind: z.literal("ai"),
      difficulty: difficultySchema,
      playerBreaks: z.boolean(),
    }),
  ]),
  z.union([
    z.object({ discipline: z.enum(["eight-ball", "nine-ball"]).optional() }),
    z.object({ discipline: z.literal("snooker"), reds: redsSchema }),
  ]),
);

export const billiardsStateSchema: z.ZodType<BilliardsState> =
  z.discriminatedUnion("variant", [
    z.strictObject({
      ...base,
      variant: z.enum(["eight-ball", "practice"]),
      groups: z
        .array(z.enum(["solids", "stripes"]).nullable())
        .min(1)
        .max(2),
      openTable: z.boolean(),
      discipline: z.enum(["eight-ball", "nine-ball", "snooker"]).optional(),
      reds: redsSchema.optional(),
    }),
    z.strictObject({
      ...base,
      variant: z.literal("nine-ball"),
      rackSeed: countSchema.max(4294967295),
      breaker: seatSchema,
      placementRegion: z.enum(["head", "table"]).nullable(),
      pushOutAvailable: z.boolean(),
      consecutiveFouls: pair,
      warned: z.array(z.boolean()).length(2),
      decision: z
        .union([
          z.strictObject({
            kind: z.enum(["push-out", "illegal-break"]),
            seat: seatSchema,
            shooter: seatSchema,
          }),
          z.strictObject({ kind: z.literal("warning"), seat: seatSchema }),
          z.strictObject({
            kind: z.literal("stalemate"),
            seat: seatSchema,
            proposer: seatSchema,
          }),
        ])
        .nullable(),
    }),
    z.strictObject({
      ...base,
      ...position,
      variant: z.literal("snooker"),
      reds: redsSchema,
      frameSeed: countSchema.max(4294967295),
      scores: pair,
      currentBreak: countSchema,
      highestBreaks: pair,
      decision: z
        .discriminatedUnion("kind", [
          z.strictObject({
            kind: z.literal("foul"),
            seat: seatSchema,
            shooter: seatSchema,
            replace: z.strictObject(position).nullable(),
            anywhere: z.boolean(),
            warning: z.enum(["three-miss", "six-red"]).nullable(),
          }),
          z.strictObject({ kind: z.literal("black-choice"), seat: seatSchema }),
        ])
        .nullable(),
      missRun: z
        .strictObject({
          shooter: seatSchema,
          count: countSchema,
          fullBallFailures: countSchema,
          warned: z.boolean(),
          sixWarned: z.boolean(),
        })
        .nullable(),
      lastScore: z
        .strictObject({
          points: countSchema,
          penalty: countSchema,
          miss: z.boolean(),
          respotted: z.array(ballId).max(22),
        })
        .nullable(),
      respottedBlack: z.boolean(),
    }),
  ]);

export const billiardsCheckpointSchema = checkpointSchema(
  BILLIARDS_GAME_ID,
  billiardsModeSchema,
  billiardsStateSchema,
).refine(({ mode, history }) =>
  history.every((state) => {
    const discipline = mode.discipline ?? "eight-ball";
    const variant = mode.kind === "practice" ? "practice" : discipline;
    const seats = mode.kind === "practice" ? 1 : 2;
    if (
      state.variant !== variant ||
      state.turnSeat >= seats ||
      state.foulCounts.length !== seats
    )
      return false;
    const reds = mode.discipline === "snooker" ? mode.reds : 15;
    const ids =
      discipline === "snooker"
        ? [
            0,
            2,
            3,
            4,
            5,
            6,
            7,
            ...Array.from({ length: reds }, (_, index) => index + 8),
          ]
        : Array.from(
            { length: discipline === "nine-ball" ? 10 : 16 },
            (_, index) => index,
          );
    return (
      state.balls.length === ids.length &&
      state.balls.every((ball) => ids.includes(ball.id)) &&
      (state.variant !== "practice" || state.discipline === discipline) &&
      (state.variant !== "snooker" || state.reds === reds)
    );
  }),
);
