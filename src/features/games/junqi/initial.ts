import { createRng } from "../engine/ai";
import { isCamp } from "./board";
import { arrangeSide } from "./deployment";
import { createOpenInitialState } from "./open-rules";
import type { Board, JunqiState, JunqiVariant, Side } from "./types";

export function shuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  const rng = createRng(seed);
  for (let n = result.length - 1; n > 0; n--) {
    const at = Math.floor(rng() * (n + 1));
    [result[n], result[at]] = [result[at], result[n]];
  }
  return result;
}

export function opaqueBoard(board: Board, seed: number, side?: Side): Board {
  // 标识与种类、棋位脱钩；排列随机源仅裁判持有，不进入观察信息。
  const ids = shuffle(
    Array.from({ length: 60 }, (_, i) => `p${i}`),
    seed,
  );
  let cursor = 0;
  const used = new Set(
    board.filter((p) => p && p.side !== side).map((p) => p?.id),
  );
  return board.map((piece) => {
    if (!piece || (side !== undefined && piece.side !== side)) return piece;
    while (side !== undefined && used.has(ids[cursor])) cursor++;
    return { ...piece, id: ids[cursor++] };
  });
}

export function createGameState(
  variant: JunqiVariant = "open",
  seed = 0,
): JunqiState {
  const base = createOpenInitialState();
  if (variant === "open") return base;
  const arranged = arrangeSide(
    arrangeSide(base.board, 0, seed),
    1,
    seed ^ 0x43718,
  );
  if (variant === "hidden")
    return {
      ...base,
      variant,
      seed,
      board: opaqueBoard(arranged, seed ^ 0x7371),
      flagShown: [false, false],
      knowledge: [{}, {}],
    };
  const pieces = shuffle(
    arranged.filter((piece) => piece !== null),
    seed ^ 0x4f612,
  );
  let cursor = 0;
  const board = opaqueBoard(
    Array.from({ length: 60 }, (_, index) =>
      isCamp(index) ? null : pieces[cursor++],
    ),
    seed ^ 0x9731,
  );
  const state: JunqiState = {
    ...base,
    variant,
    seed,
    board,
    phase: "playing",
    ready: [true, true],
    revealed: [],
    sides: null,
  };
  return state;
}
