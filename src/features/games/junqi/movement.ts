import {
  colOf,
  isCamp,
  isHeadquarters,
  RAIL_NEIGHBORS,
  ROAD_NEIGHBORS,
  rowOf,
  validCell,
} from "./board";
import type { Board, PieceKind, Side, Step } from "./types";

export function destinations(
  board: readonly ({
    id: string;
    side: Side | null;
    kind?: PieceKind;
  } | null)[],
  from: number,
  options: { lockHeadquarters?: boolean; covered?: readonly string[] } = {},
): number[] {
  if (!validCell(from)) return [];
  const piece = board[from];
  if (
    !piece ||
    !piece.kind ||
    piece.kind === "flag" ||
    piece.kind === "mine" ||
    ((options.lockHeadquarters ?? true) && isHeadquarters(from))
  )
    return [];
  const result = new Set<number>();
  const mayEnter = (to: number) =>
    !board[to] ||
    (board[to]?.side !== piece.side &&
      !isCamp(to) &&
      !options.covered?.includes(board[to]?.id ?? ""));
  for (const to of ROAD_NEIGHBORS[from]) if (mayEnter(to)) result.add(to);
  if (piece.kind === "engineer") {
    const visited = new Set([from]);
    const pending = [from];
    for (let cursor = 0; cursor < pending.length; cursor++) {
      for (const to of RAIL_NEIGHBORS[pending[cursor]]) {
        if (visited.has(to)) continue;
        visited.add(to);
        if (mayEnter(to)) result.add(to);
        if (!board[to]) pending.push(to);
      }
    }
  } else {
    for (const first of RAIL_NEIGHBORS[from]) {
      const dr = rowOf(first) - rowOf(from),
        dc = colOf(first) - colOf(from);
      let previous = from,
        to: number | undefined = first;
      while (to !== undefined) {
        if (mayEnter(to)) result.add(to);
        if (board[to]) break;
        const current: number = to;
        to = RAIL_NEIGHBORS[current].find(
          (candidate) =>
            candidate !== previous &&
            rowOf(candidate) - rowOf(current) === dr &&
            colOf(candidate) - colOf(current) === dc,
        );
        previous = current;
      }
    }
  }
  return [...result];
}

export function legalMoves(board: Board, side: Side): Step[] {
  return board.flatMap((piece, from) =>
    piece?.side === side
      ? destinations(board, from).map((to): Step => ({
          type: "move",
          from,
          to,
        }))
      : [],
  );
}
