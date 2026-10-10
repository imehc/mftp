import { z } from "zod";

import { BOARD_COLS, BOARD_ROWS, type XiangqiMove } from "./types";

const position = z
  .number()
  .int()
  .min(0)
  .max(BOARD_ROWS * BOARD_COLS - 1);
const moveSchema = z.object({ from: position, to: position });

export function parseXiangqiMove(value: unknown): XiangqiMove | null {
  if (!z.validate(moveSchema, value) || value.from === value.to) return null;
  return { from: value.from, to: value.to };
}
