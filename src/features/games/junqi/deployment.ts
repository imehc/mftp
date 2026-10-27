import { createRng } from "../engine/ai";
import {
  CELLS,
  frontDistance,
  homeSide,
  isCamp,
  isHeadquarters,
  validCell,
} from "./board";
import { invalidAction } from "./errors";
import {
  type Board,
  type Piece,
  PIECE_COUNTS,
  type PieceKind,
  type Side,
} from "./types";

export function canDeploy(piece: Piece, index: number): boolean {
  if (!validCell(index) || isCamp(index) || homeSide(index) !== piece.side)
    return false;
  if (piece.kind === "flag") return isHeadquarters(index);
  if (piece.kind === "mine") return frontDistance(index) >= 4;
  return piece.kind !== "bomb" || frontDistance(index) > 0;
}

export function validDeployment(board: Board, side: Side): boolean {
  const counts = { ...PIECE_COUNTS } as Record<PieceKind, number>;
  const ids = new Set<string>();
  for (let index = 0; index < board.length; index++) {
    const piece = board[index];
    if (piece?.side !== side) continue;
    if (!canDeploy(piece, index) || ids.has(piece.id)) return false;
    ids.add(piece.id);
    counts[piece.kind]--;
  }
  return (
    board.length === CELLS &&
    Object.values(counts).every((count) => count === 0)
  );
}

export function arrangeSide(board: Board, side: Side, seed: number): Board {
  const next = board.map((piece) => (piece?.side === side ? null : piece));
  const rng = createRng(seed);
  // 先安放限制最多的棋子，保证随机布阵不会把军旗或地雷挤出合法位置。
  const kinds: PieceKind[] = [
    "flag",
    "mine",
    "bomb",
    "commander",
    "general",
    "division",
    "brigade",
    "regiment",
    "battalion",
    "company",
    "platoon",
    "engineer",
  ];
  for (const kind of kinds) {
    for (let n = 0; n < PIECE_COUNTS[kind]; n++) {
      const piece: Piece = { id: `${side}-${kind}-${n}`, side, kind };
      const candidates = next.flatMap((existing, index) =>
        !existing && canDeploy(piece, index) ? [index] : [],
      );
      const index = candidates[Math.floor(rng() * candidates.length)];
      if (index === undefined)
        throw invalidAction("junqi: no legal deployment cell");
      next[index] = piece;
    }
  }
  return next;
}

export function canSwap(
  board: Board,
  from: number,
  to: number,
  side: Side,
): boolean {
  if (!validCell(from) || !validCell(to) || from === to) return false;
  const a = board[from],
    b = board[to];
  return (
    !!a &&
    !!b &&
    a.side === side &&
    b.side === side &&
    canDeploy(a, to) &&
    canDeploy(b, from)
  );
}
