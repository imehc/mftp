import { z } from "zod";
import { BOARD_SIZE, type GomokuMove } from "./types";

const coordinate = z
  .number()
  .int()
  .min(0)
  .max(BOARD_SIZE - 1);
const moveSchema = z.object({ row: coordinate, col: coordinate });

export function parseGomokuMove(value: unknown): GomokuMove | null {
  const parsed = moveSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
