import { colOf, rowOf } from "../board";

export const VIEW_WIDTH = 6.8;
export const VIEW_HEIGHT = 12.9;
export const BOARD_WIDTH = 6.5;
export const BOARD_HEIGHT = 12.6;

export function cellPosition(
  index: number,
  flipped = false,
  landscape = false,
): { x: number; y: number } {
  const cell = flipped ? 59 - index : index;
  const x = (colOf(cell) - 2) * 1.26;
  const y = 5.5 - rowOf(cell) + (cell < 30 ? 0.2 : -0.2);
  return landscape ? { x: y, y: -x } : { x, y };
}

export const viewSize = (landscape: boolean) =>
  landscape
    ? { width: VIEW_HEIGHT, height: VIEW_WIDTH }
    : { width: VIEW_WIDTH, height: VIEW_HEIGHT };
