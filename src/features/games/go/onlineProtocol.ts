import { z } from "zod";

import type { BoardSize, GoMove } from "./types";

export function goMoveParser(boardSize: BoardSize) {
  const coordinate = z
    .number()
    .int()
    .min(0)
    .max(boardSize - 1);
  const schema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("play"), row: coordinate, col: coordinate }),
    z.object({ kind: z.literal("pass") }),
  ]);
  return (value: unknown): GoMove | null => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };
}
