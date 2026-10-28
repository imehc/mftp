import type { PuzzleBoard, PuzzleSize } from "./types";

export function createSolved(size: PuzzleSize): PuzzleBoard {
  return {
    size,
    tiles: Array.from(
      { length: size * size },
      (_, i) => (i + 1) % (size * size),
    ),
  };
}

export function validBoard(board: PuzzleBoard): boolean {
  return (
    [3, 4, 5].includes(board.size) &&
    board.tiles.length === board.size ** 2 &&
    new Set(board.tiles).size === board.tiles.length &&
    board.tiles.every(
      (tile) =>
        Number.isInteger(tile) && tile >= 0 && tile < board.tiles.length,
    )
  );
}

export function isSolved(board: PuzzleBoard): boolean {
  return (
    validBoard(board) &&
    board.tiles.every((tile, i) => tile === (i + 1) % board.tiles.length)
  );
}

export function isSolvable(board: PuzzleBoard): boolean {
  if (!validBoard(board)) return false;
  let inversions = 0;
  for (let i = 0; i < board.tiles.length; i++) {
    for (let j = i + 1; j < board.tiles.length; j++) {
      if (board.tiles[i] && board.tiles[j] && board.tiles[i] > board.tiles[j])
        inversions++;
    }
  }
  if (board.size % 2) return inversions % 2 === 0;
  const rowFromBottom =
    board.size - Math.floor(board.tiles.indexOf(0) / board.size);
  return (inversions + rowFromBottom) % 2 === 1;
}

export function canMove(board: PuzzleBoard, tile: number): boolean {
  if (!Number.isInteger(tile) || tile <= 0) return false;
  const index = board.tiles.indexOf(tile);
  const empty = board.tiles.indexOf(0);
  if (index < 0 || empty < 0) return false;
  return (
    Math.abs((index % board.size) - (empty % board.size)) +
      Math.abs(
        Math.floor(index / board.size) - Math.floor(empty / board.size),
      ) ===
    1
  );
}

/** 移动由数字身份表示，同一数字再次移动就是逆操作。 */
export function moveTile(board: PuzzleBoard, tile: number): PuzzleBoard {
  if (!canMove(board, tile)) return board;
  const tiles = [...board.tiles];
  const index = tiles.indexOf(tile),
    empty = tiles.indexOf(0);
  [tiles[index], tiles[empty]] = [tiles[empty], tiles[index]];
  return { size: board.size, tiles };
}

export function scrambleBoard(
  size: PuzzleSize,
  random = Math.random,
): PuzzleBoard {
  const board = createSolved(size);
  for (let i = board.tiles.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [board.tiles[i], board.tiles[j]] = [board.tiles[j], board.tiles[i]];
  }
  // 两个非空数字互换只改变奇偶性，因此可以修正可解性而不改变空位行号。
  if (!isSolvable(board)) {
    const a = board.tiles.findIndex((tile) => tile !== 0);
    const b = board.tiles.findIndex((tile, i) => i > a && tile !== 0);
    [board.tiles[a], board.tiles[b]] = [board.tiles[b], board.tiles[a]];
  }
  return isSolved(board) ? moveTile(board, size * size - 1) : board;
}

/** 方向键移动焦点的位置，行边界不允许穿越。 */
export function focusNeighbor(
  index: number,
  size: PuzzleSize,
  key: string,
): number {
  const row = Math.floor(index / size),
    col = index % size;
  if (key === "ArrowLeft" && col > 0) return index - 1;
  if (key === "ArrowRight" && col < size - 1) return index + 1;
  if (key === "ArrowUp" && row > 0) return index - size;
  if (key === "ArrowDown" && row < size - 1) return index + size;
  return index;
}
