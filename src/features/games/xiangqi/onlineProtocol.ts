import { z } from "zod";

import { BOARD_COLS, BOARD_ROWS, type XiangqiMove } from "./types";

const position = z
  .number()
  .int()
  .min(0)
  .max(BOARD_ROWS * BOARD_COLS - 1);
const moveSchema = z.object({ from: position, to: position });

export function parseXiangqiMove(value: unknown): XiangqiMove | null {
  const parsed = moveSchema.safeParse(value);
  if (!parsed.success || parsed.data.from === parsed.data.to) return null;
  return parsed.data;
}
