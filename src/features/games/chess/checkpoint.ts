import { z } from "zod";

import {
  boardModeSchema,
  checkpointSchema,
  countSchema,
  seatSchema,
} from "../engine/checkpoint-schema";
import { applyChessMove, chessGame, createChessState } from "./rules";
import { CHESS_GAME_ID, type ChessMove, type ChessState } from "./types";

const square = z.string().regex(/^[a-h][1-8]$/);
const turnSchema = z.strictObject({
  from: square,
  to: square,
  promotion: z.enum(["q", "r", "b", "n"]).optional(),
});
export const chessMoveSchema = z.discriminatedUnion("type", [
  turnSchema.extend({ type: z.literal("move") }),
  z.strictObject({ type: z.literal("claim"), intended: turnSchema.optional() }),
]) as z.ZodType<ChessMove>;
export const chessStateSchema: z.ZodType<ChessState> = z.strictObject({
  fen: z.string().min(15).max(100),
  positions: z.array(z.string().max(90)).min(1).max(151),
  ply: countSchema.max(10000),
  lastAction: chessMoveSchema.nullable(),
  result: z
    .enum([
      "checkmate",
      "stalemate",
      "material",
      "fivefold",
      "seventy-five",
      "threefold",
      "fifty",
    ])
    .nullable(),
  winnerSeat: seatSchema.nullable(),
});

export function serializeChessState(state: ChessState): string {
  const action = state.lastAction;
  const turn = action?.type === "move" ? action : action?.intended;
  return JSON.stringify([
    state.fen,
    state.positions,
    state.ply,
    state.result,
    state.winnerSeat,
    action?.type ?? null,
    turn ? [turn.from, turn.to, turn.promotion ?? null] : null,
  ]);
}

export const chessCheckpointSchema = checkpointSchema(
  CHESS_GAME_ID,
  boardModeSchema,
  chessStateSchema,
).refine(({ history }) => {
  if (
    serializeChessState(history[0]) !== serializeChessState(createChessState())
  )
    return false;
  try {
    return history.slice(1).every((state, index) => {
      const before = history[index],
        seat = chessGame.currentSeat(before);
      if (!state.lastAction || seat === null) return false;
      return (
        serializeChessState(
          applyChessMove(before, state.lastAction, seat).state,
        ) === serializeChessState(state)
      );
    });
  } catch {
    return false;
  }
});

export function parseChessMove(value: unknown): ChessMove | null {
  const parsed = chessMoveSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
