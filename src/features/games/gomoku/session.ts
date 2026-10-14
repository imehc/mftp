import { z } from "zod";

import { createBoardSession } from "../engine/board-session";
import {
  boardModeSchema,
  checkpointSchema,
  countSchema,
  seatSchema,
} from "../engine/checkpoint-schema";
import { GameSessionStore } from "../engine/game-session-store";
import { exitOnlineRoom } from "../engine/online/online-session-store";
import { gomokuAiStrategy } from "./ai";
import { createInitialGomokuState, gomokuGame } from "./rules";
import type { GomokuMode, GomokuMove, GomokuState } from "./types";
import { BOARD_SIZE, GOMOKU_GAME_ID } from "./types";

const coordinate = countSchema.max(BOARD_SIZE - 1);
export const gomokuStateSchema: z.ZodType<GomokuState> = z.strictObject({
  board: z.array(seatSchema.nullable()).length(BOARD_SIZE * BOARD_SIZE),
  turnSeat: seatSchema,
  winnerSeat: seatSchema.nullable(),
  winningLine: z.array(countSchema.max(BOARD_SIZE * BOARD_SIZE - 1)).max(5),
  finished: z.boolean(),
  moveCount: countSchema.max(BOARD_SIZE * BOARD_SIZE),
  lastMove: z.strictObject({ row: coordinate, col: coordinate }).nullable(),
});

export const gomokuCheckpointSchema = checkpointSchema(
  GOMOKU_GAME_ID,
  boardModeSchema,
  gomokuStateSchema,
).refine((checkpoint) =>
  checkpoint.history.every((state, index) => state.moveCount === index),
);

export const gomokuSessions = new GameSessionStore<
  GomokuMode,
  GomokuState,
  GomokuMove,
  GomokuMove
>({
  gameId: GOMOKU_GAME_ID,
  schema: gomokuCheckpointSchema,
  create: (mode, hooks, checkpoint) =>
    createBoardSession(
      mode,
      gomokuGame,
      createInitialGomokuState(),
      gomokuAiStrategy,
      hooks,
      checkpoint,
    ),
  online: (mode) => mode.kind === "online",
  exitOnline: () => exitOnlineRoom(GOMOKU_GAME_ID),
});
