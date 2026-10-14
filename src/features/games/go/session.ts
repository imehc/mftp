import { z } from "zod";

import { createBoardSession } from "../engine/board-session";
import {
  checkpointSchema,
  countSchema,
  difficultySchema,
  seatSchema,
} from "../engine/checkpoint-schema";
import { GameSessionStore } from "../engine/game-session-store";
import { exitOnlineRoom } from "../engine/online/online-session-store";
import { goAiStrategy } from "./ai";
import { createInitialGoState, goGame } from "./rules";
import type { GoMode, GoMove, GoPresentation, GoState } from "./types";
import { GO_GAME_ID } from "./types";

const sizeSchema = z.union([z.literal(9), z.literal(13), z.literal(19)]);
const modeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("hotseat"), boardSize: sizeSchema }),
  z.strictObject({
    kind: z.literal("ai"),
    boardSize: sizeSchema,
    localSeat: seatSchema,
    difficulty: difficultySchema,
  }),
]);
const moveSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("pass") }),
  z.strictObject({
    kind: z.literal("play"),
    row: countSchema.max(18),
    col: countSchema.max(18),
  }),
]);

export const goStateSchema: z.ZodType<GoState> = z
  .strictObject({
    boardSize: sizeSchema,
    board: z.array(seatSchema.nullable()).max(361),
    turnSeat: seatSchema,
    koPoint: countSchema.max(360).nullable(),
    captures: z.tuple([countSchema, countSchema]),
    consecutivePasses: countSchema.max(2),
    positionHistory: z.array(z.string().max(361)).max(10000),
    finished: z.boolean(),
    winnerSeat: seatSchema.nullable(),
    finalScore: z.tuple([z.number(), z.number()]).nullable(),
    moveCount: countSchema,
    lastMove: moveSchema.nullable(),
    lastCaptured: z
      .array(z.strictObject({ index: countSchema.max(360), seat: seatSchema }))
      .max(361),
  })
  .refine(
    (state) =>
      state.board.length === state.boardSize * state.boardSize &&
      (state.koPoint === null || state.koPoint < state.board.length) &&
      (state.lastMove?.kind !== "play" ||
        (state.lastMove.row < state.boardSize &&
          state.lastMove.col < state.boardSize)),
  );

export const goCheckpointSchema = checkpointSchema(
  GO_GAME_ID,
  modeSchema,
  goStateSchema,
).refine((checkpoint) =>
  checkpoint.history.every(
    (state, index) =>
      state.moveCount === index &&
      state.boardSize === checkpoint.mode.boardSize,
  ),
);

export const goSessions = new GameSessionStore<
  GoMode,
  GoState,
  GoMove,
  GoPresentation
>({
  gameId: GO_GAME_ID,
  schema: goCheckpointSchema,
  create: (mode, hooks, checkpoint) =>
    createBoardSession(
      mode,
      goGame,
      createInitialGoState(mode.boardSize),
      goAiStrategy,
      hooks,
      checkpoint,
    ),
  online: (mode) => mode.kind === "online",
  exitOnline: (mode) => exitOnlineRoom(`${GO_GAME_ID}-${mode.boardSize}`),
});
