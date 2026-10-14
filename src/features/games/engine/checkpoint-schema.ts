import { z } from "zod";

export const seatSchema = z.union([z.literal(0), z.literal(1)]);
export const countSchema = z.number().int().nonnegative();
export const difficultySchema = z.enum(["easy", "medium", "hard"]);
export const boardModeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("hotseat") }),
  z.strictObject({
    kind: z.literal("ai"),
    difficulty: difficultySchema,
    localSeat: seatSchema,
  }),
]);

export function checkpointSchema<Mode, State>(
  gameId: string,
  mode: z.ZodType<Mode>,
  state: z.ZodType<State>,
  version = 1,
) {
  return z.strictObject({
    version: z.literal(version),
    gameId: z.literal(gameId),
    id: z.string().uuid(),
    savedAt: z.number().int().nonnegative(),
    mode,
    history: z.array(state).min(1).max(10000),
  });
}
