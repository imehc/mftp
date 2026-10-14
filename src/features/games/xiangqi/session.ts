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
import { xiangqiAiStrategy } from "./ai";
import { createInitialXiangqiState, xiangqiGame } from "./rules";
import type {
  XiangqiMode,
  XiangqiMove,
  XiangqiPresentation,
  XiangqiState,
} from "./types";
import { BOARD_COLS, BOARD_ROWS, XIANGQI_GAME_ID } from "./types";

const indexSchema = countSchema.max(BOARD_ROWS * BOARD_COLS - 1);
const pieceSchema = z.strictObject({
  side: seatSchema,
  kind: z.enum([
    "general",
    "advisor",
    "elephant",
    "horse",
    "rook",
    "cannon",
    "soldier",
  ]),
});
export const xiangqiStateSchema: z.ZodType<XiangqiState> = z.strictObject({
  board: z.array(pieceSchema.nullable()).length(BOARD_ROWS * BOARD_COLS),
  turnSeat: seatSchema,
  winnerSeat: seatSchema.nullable(),
  finished: z.boolean(),
  resultReason: z
    .enum([
      "general-captured",
      "checkmate",
      "stalemate",
      "repetition",
      "no-capture",
    ])
    .nullable(),
  moveCount: countSchema,
  halfmoveClock: countSchema,
  positionCounts: z.record(z.string(), countSchema),
  lastMove: z.strictObject({ from: indexSchema, to: indexSchema }).nullable(),
  lastCaptured: pieceSchema.nullable(),
  inCheck: z.boolean(),
});

export const xiangqiCheckpointSchema = checkpointSchema(
  XIANGQI_GAME_ID,
  boardModeSchema,
  xiangqiStateSchema,
).refine((checkpoint) =>
  checkpoint.history.every((state, index) => state.moveCount === index),
);

export const xiangqiSessions = new GameSessionStore<
  XiangqiMode,
  XiangqiState,
  XiangqiMove,
  XiangqiPresentation
>({
  gameId: XIANGQI_GAME_ID,
  schema: xiangqiCheckpointSchema,
  create: (mode, hooks, checkpoint) =>
    createBoardSession(
      mode,
      xiangqiGame,
      createInitialXiangqiState(),
      xiangqiAiStrategy,
      hooks,
      checkpoint,
    ),
  online: (mode) => mode.kind === "online",
  exitOnline: () => exitOnlineRoom(XIANGQI_GAME_ID),
});
