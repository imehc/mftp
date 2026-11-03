import { z } from "zod";

const competitor = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("seat"),
    seat: z.number().int().min(0).max(63),
  }),
  z.strictObject({
    kind: z.literal("team"),
    teamId: z.string().min(1).max(256),
  }),
]);
const metadata = {
  ranking: z
    .array(
      z.strictObject({
        rank: z.number().int().positive(),
        competitors: z.array(competitor).min(1).max(64),
      }),
    )
    .max(64)
    .optional(),
  details: z.json().optional(),
};

/** 联机结果保留团队、并列及游戏自定义值，不将结果压成单个胜者。 */
export const gameOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("victory"),
    winners: z.array(competitor).min(1).max(64),
    ...metadata,
  }),
  z.strictObject({ kind: z.literal("draw"), ...metadata }),
  z.strictObject({ kind: z.literal("custom"), result: z.json(), ...metadata }),
]);
