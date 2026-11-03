import { z } from "zod";

const participantSeat = z.number().int().min(0).max(63);
const participantTeam = z.string().min(1).max(128).optional();
export const seatSchema = z.union([z.literal(0), z.literal(1)]);
export const countSchema = z.number().int().nonnegative();
export const difficultySchema = z.enum(["easy", "medium", "hard"]);
const participantBase = { seat: participantSeat, teamId: participantTeam };
export const participantConfigurationSchema = z
  .strictObject({
    version: z.literal(1),
    viewerSeat: z.union([participantSeat, z.literal("active")]),
    seats: z
      .array(
        z.discriminatedUnion("kind", [
          z.strictObject({ kind: z.literal("local"), ...participantBase }),
          z.strictObject({
            kind: z.literal("computer"),
            difficulty: difficultySchema,
            ...participantBase,
          }),
          z.strictObject({
            kind: z.literal("remote"),
            memberId: z.string().min(1).max(128),
            ...participantBase,
          }),
        ]),
      )
      .min(1)
      .max(64),
  })
  .refine((configuration) => {
    const seats = new Set(configuration.seats.map((seat) => seat.seat));
    return (
      seats.size === configuration.seats.length &&
      configuration.seats.every(
        (seat) => seat.seat < configuration.seats.length,
      ) &&
      (configuration.viewerSeat === "active" ||
        seats.has(configuration.viewerSeat))
    );
  });
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
    participants: participantConfigurationSchema.optional(),
    rulesVersion: z.number().int().positive().optional(),
  });
}
