import { z } from "zod";

import {
  boardModeSchema,
  checkpointSchema,
  countSchema,
  seatSchema,
} from "../engine/checkpoint-schema";
import { applyReversiMove, createInitialReversiState } from "./rules";
import { REVERSI_GAME_ID, type ReversiState } from "./types";

const coordinate = countSchema.max(7);
export const reversiStateSchema: z.ZodType<ReversiState> = z.strictObject({
  board: z.array(seatSchema.nullable()).length(64),
  turnSeat: seatSchema,
  winnerSeat: seatSchema.nullable(),
  finished: z.boolean(),
  moveCount: countSchema.max(60),
  lastMove: z
    .strictObject({ row: coordinate, col: coordinate, seat: seatSchema })
    .nullable(),
  passedSeat: seatSchema.nullable(),
});

/** 按固定顺序序列化，校验和网络哈希均不依赖对象属性插入顺序。 */
export function serializeReversiState(state: ReversiState): string {
  return JSON.stringify([
    state.board,
    state.turnSeat,
    state.winnerSeat,
    state.finished,
    state.moveCount,
    state.lastMove && [
      state.lastMove.row,
      state.lastMove.col,
      state.lastMove.seat,
    ],
    state.passedSeat,
  ]);
}

export const reversiCheckpointSchema = checkpointSchema(
  REVERSI_GAME_ID,
  boardModeSchema,
  reversiStateSchema,
).refine(({ history }) => {
  if (
    history.length > 61 ||
    serializeReversiState(history[0]) !==
      serializeReversiState(createInitialReversiState())
  )
    return false;
  try {
    return history.slice(1).every((state, index) => {
      if (!state.lastMove) return false;
      const expected = applyReversiMove(
        history[index],
        state.lastMove,
        state.lastMove.seat,
      ).state;
      return serializeReversiState(expected) === serializeReversiState(state);
    });
  } catch {
    return false;
  }
});
