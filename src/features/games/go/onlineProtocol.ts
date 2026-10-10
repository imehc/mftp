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
    if (!z.validate(schema, value)) return null;
    // 验证只返回布尔值，显式提取字段以保留原解析器的输出边界。
    if (value.kind === "pass") return { kind: "pass" };
    return { kind: "play", row: value.row, col: value.col };
  };
}
