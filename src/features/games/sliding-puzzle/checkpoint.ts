import { z } from "zod";

import { canMove, isSolvable, isSolved, moveTile } from "./engine";
import { PUZZLE_ID } from "./types";

export const MAX_PUZZLE_HISTORY = 500;
export const sizeSchema = z.union([z.literal(3), z.literal(4), z.literal(5)]);
const boardSchema = z
  .strictObject({
    size: sizeSchema,
    tiles: z.array(z.number().int().min(0).max(24)).min(9).max(25),
  })
  .refine(isSolvable);
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const puzzleCheckpointSchema = z
  .strictObject({
    version: z.literal(1),
    gameId: z.literal(PUZZLE_ID),
    id: z.string().uuid(),
    initial: boardSchema,
    base: boardSchema,
    moves: z.array(z.number().int().min(1).max(24)).max(MAX_PUZZLE_HISTORY),
    cursor: countSchema.max(MAX_PUZZLE_HISTORY),
    offset: countSchema,
    elapsedMs: z.number().nonnegative().finite(),
    started: z.boolean(),
    completed: z.boolean(),
    assisted: z.boolean(),
  })
  .refine((data) => {
    if (
      data.initial.size !== data.base.size ||
      isSolved(data.initial) ||
      data.cursor > data.moves.length
    )
      return false;
    if (
      !data.offset &&
      data.initial.tiles.some((tile, i) => tile !== data.base.tiles[i])
    )
      return false;
    if (
      !data.started &&
      (data.moves.length > 0 ||
        data.offset > 0 ||
        data.elapsedMs > 0 ||
        data.completed)
    )
      return false;
    let board = data.base;
    let current = board;
    for (let i = 0; i < data.moves.length; i++) {
      if (!canMove(board, data.moves[i]) || isSolved(board)) return false;
      board = moveTile(board, data.moves[i]);
      if (i + 1 === data.cursor) current = board;
    }
    return data.completed === isSolved(current);
  });

export type PuzzleCheckpoint = z.infer<typeof puzzleCheckpointSchema>;

export function checkpointBoard(data: PuzzleCheckpoint) {
  return data.moves.slice(0, data.cursor).reduce(moveTile, data.base);
}

export const puzzleRecordSchema = z.object({
  size: sizeSchema,
  moves: countSchema,
  elapsedMs: z.number().nonnegative().finite(),
  assisted: z.boolean(),
});
