export const PUZZLE_SIZES = [3, 4, 5] as const;
export const PUZZLE_ID = "sliding-puzzle";

export type PuzzleSize = (typeof PUZZLE_SIZES)[number];

export interface PuzzleBoard {
  size: PuzzleSize;
  tiles: number[];
}

export interface PuzzleRecord {
  size: PuzzleSize;
  moves: number;
  elapsedMs: number;
  assisted: boolean;
}
