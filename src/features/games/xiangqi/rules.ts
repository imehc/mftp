import type {
  GameDefinition,
  MoveResolution,
  SeatIndex,
} from "../engine/types";
import {
  BOARD_COLS,
  BOARD_ROWS,
  type PieceKind,
  type XiangqiMove,
  type XiangqiPiece,
  type XiangqiPresentation,
  type XiangqiResultReason,
  type XiangqiState,
} from "./types";

const ORTHOGONAL_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const BACK_RANK: readonly PieceKind[] = [
  "rook",
  "horse",
  "elephant",
  "advisor",
  "general",
  "advisor",
  "elephant",
  "horse",
  "rook",
];

export function boardIndex(row: number, col: number): number {
  return row * BOARD_COLS + col;
}

export function boardCoordinate(index: number): { row: number; col: number } {
  return { row: Math.floor(index / BOARD_COLS), col: index % BOARD_COLS };
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
}

function place(
  board: Array<XiangqiPiece | null>,
  side: SeatIndex,
  kind: PieceKind,
  row: number,
  col: number,
): void {
  board[boardIndex(row, col)] = { side, kind };
}

export function boardPositionKey(
  board: readonly (XiangqiPiece | null)[],
  turnSeat: SeatIndex,
): string {
  const pieces = board
    .map((piece) =>
      piece
        ? `${piece.side}${piece.kind[0]}${piece.kind === "horse" ? "h" : ""}`
        : ".",
    )
    .join("");
  return `${pieces}|${turnSeat}`;
}

export function createInitialXiangqiState(): XiangqiState {
  const board = Array<XiangqiPiece | null>(BOARD_ROWS * BOARD_COLS).fill(null);
  BACK_RANK.forEach((kind, col) => {
    place(board, 1, kind, 0, col);
    place(board, 0, kind, 9, col);
  });
  for (const col of [1, 7]) {
    place(board, 1, "cannon", 2, col);
    place(board, 0, "cannon", 7, col);
  }
  for (const col of [0, 2, 4, 6, 8]) {
    place(board, 1, "soldier", 3, col);
    place(board, 0, "soldier", 6, col);
  }
  const key = boardPositionKey(board, 0);
  return {
    board,
    turnSeat: 0,
    winnerSeat: null,
    finished: false,
    resultReason: null,
    moveCount: 0,
    halfmoveClock: 0,
    positionCounts: { [key]: 1 },
    lastMove: null,
    lastCaptured: null,
    inCheck: false,
  };
}

function inPalace(side: SeatIndex, row: number, col: number): boolean {
  if (col < 3 || col > 5) return false;
  return side === 0 ? row >= 7 && row <= 9 : row >= 0 && row <= 2;
}

function crossedRiver(side: SeatIndex, row: number): boolean {
  return side === 0 ? row <= 4 : row >= 5;
}

function addTarget(
  board: readonly (XiangqiPiece | null)[],
  side: SeatIndex,
  targets: number[],
  row: number,
  col: number,
): void {
  if (!inBounds(row, col)) return;
  const index = boardIndex(row, col);
  if (board[index]?.side !== side) targets.push(index);
}

function slidingTargets(
  board: readonly (XiangqiPiece | null)[],
  piece: XiangqiPiece,
  row: number,
  col: number,
): number[] {
  const targets: number[] = [];
  for (const [dr, dc] of ORTHOGONAL_DIRECTIONS) {
    let screenSeen = false;
    for (let step = 1; ; step++) {
      const nextRow = row + dr * step;
      const nextCol = col + dc * step;
      if (!inBounds(nextRow, nextCol)) break;
      const index = boardIndex(nextRow, nextCol);
      const occupant = board[index];
      if (piece.kind === "rook") {
        if (!occupant) {
          targets.push(index);
          continue;
        }
        if (occupant.side !== piece.side) targets.push(index);
        break;
      }
      if (!screenSeen) {
        if (!occupant) targets.push(index);
        else screenSeen = true;
        continue;
      }
      if (!occupant) continue;
      if (occupant.side !== piece.side) targets.push(index);
      break;
    }
  }
  return targets;
}

function generalTargets(
  board: readonly (XiangqiPiece | null)[],
  piece: XiangqiPiece,
  row: number,
  col: number,
): number[] {
  const targets: number[] = [];
  for (const [dr, dc] of ORTHOGONAL_DIRECTIONS) {
    const nextRow = row + dr;
    const nextCol = col + dc;
    if (inPalace(piece.side, nextRow, nextCol)) {
      addTarget(board, piece.side, targets, nextRow, nextCol);
    }
  }

  for (const direction of [-1, 1]) {
    for (
      let nextRow = row + direction;
      inBounds(nextRow, col);
      nextRow += direction
    ) {
      const index = boardIndex(nextRow, col);
      const occupant = board[index];
      if (!occupant) continue;
      if (occupant.side !== piece.side && occupant.kind === "general") {
        targets.push(index);
      }
      break;
    }
  }
  return targets;
}

export function pseudoTargets(
  board: readonly (XiangqiPiece | null)[],
  from: number,
): number[] {
  const piece = board[from];
  if (!piece) return [];
  const { row, col } = boardCoordinate(from);
  if (piece.kind === "rook" || piece.kind === "cannon") {
    return slidingTargets(board, piece, row, col);
  }
  if (piece.kind === "general") return generalTargets(board, piece, row, col);

  const targets: number[] = [];
  if (piece.kind === "advisor") {
    for (const [dr, dc] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]) {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (inPalace(piece.side, nextRow, nextCol)) {
        addTarget(board, piece.side, targets, nextRow, nextCol);
      }
    }
  } else if (piece.kind === "elephant") {
    for (const [dr, dc] of [
      [-2, -2],
      [-2, 2],
      [2, -2],
      [2, 2],
    ]) {
      const nextRow = row + dr;
      const nextCol = col + dc;
      const staysHome = piece.side === 0 ? nextRow >= 5 : nextRow <= 4;
      if (
        staysHome &&
        inBounds(nextRow, nextCol) &&
        board[boardIndex(row + dr / 2, col + dc / 2)] === null
      ) {
        addTarget(board, piece.side, targets, nextRow, nextCol);
      }
    }
  } else if (piece.kind === "horse") {
    const jumps: ReadonlyArray<readonly [number, number, number, number]> = [
      [-2, -1, -1, 0],
      [-2, 1, -1, 0],
      [2, -1, 1, 0],
      [2, 1, 1, 0],
      [-1, -2, 0, -1],
      [1, -2, 0, -1],
      [-1, 2, 0, 1],
      [1, 2, 0, 1],
    ];
    for (const [dr, dc, legRow, legCol] of jumps) {
      if (board[boardIndex(row + legRow, col + legCol)] !== null) continue;
      addTarget(board, piece.side, targets, row + dr, col + dc);
    }
  } else if (piece.kind === "soldier") {
    const forward = piece.side === 0 ? -1 : 1;
    addTarget(board, piece.side, targets, row + forward, col);
    if (crossedRiver(piece.side, row)) {
      addTarget(board, piece.side, targets, row, col - 1);
      addTarget(board, piece.side, targets, row, col + 1);
    }
  }
  return targets;
}

export function applyMoveToBoard(
  board: readonly (XiangqiPiece | null)[],
  move: XiangqiMove,
): Array<XiangqiPiece | null> {
  const next = [...board];
  next[move.to] = next[move.from];
  next[move.from] = null;
  return next;
}

function findGeneral(
  board: readonly (XiangqiPiece | null)[],
  side: SeatIndex,
): number {
  return board.findIndex(
    (piece) => piece?.side === side && piece.kind === "general",
  );
}

export function isInCheck(
  board: readonly (XiangqiPiece | null)[],
  side: SeatIndex,
): boolean {
  const general = findGeneral(board, side);
  if (general < 0) return true;
  const opponent = 1 - side;
  for (let from = 0; from < board.length; from++) {
    if (board[from]?.side !== opponent) continue;
    if (pseudoTargets(board, from).includes(general)) return true;
  }
  return false;
}

export function legalMovesForSeat(
  board: readonly (XiangqiPiece | null)[],
  side: SeatIndex,
): XiangqiMove[] {
  const moves: XiangqiMove[] = [];
  for (let from = 0; from < board.length; from++) {
    if (board[from]?.side !== side) continue;
    for (const to of pseudoTargets(board, from)) {
      const move = { from, to };
      if (!isInCheck(applyMoveToBoard(board, move), side)) moves.push(move);
    }
  }
  return moves;
}

export function legalMoves(state: XiangqiState): XiangqiMove[] {
  return state.finished ? [] : legalMovesForSeat(state.board, state.turnSeat);
}

export function isLegalMove(state: XiangqiState, move: XiangqiMove): boolean {
  return legalMoves(state).some(
    (candidate) => candidate.from === move.from && candidate.to === move.to,
  );
}

function finishReason(
  board: readonly (XiangqiPiece | null)[],
  opponent: SeatIndex,
): XiangqiResultReason {
  if (findGeneral(board, opponent) < 0) return "general-captured";
  if (legalMovesForSeat(board, opponent).length > 0) return null;
  return isInCheck(board, opponent) ? "checkmate" : "stalemate";
}

export const xiangqiGame: GameDefinition<
  XiangqiState,
  XiangqiMove,
  XiangqiPresentation
> = {
  id: "xiangqi",
  seatCount: 2,
  currentSeat: (state) => (state.finished ? null : state.turnSeat),
  winnerSeat: (state) => state.winnerSeat,
  isFinished: (state) => state.finished,
  applyMove(
    state,
    move,
    seat,
  ): MoveResolution<XiangqiState, XiangqiPresentation> {
    if (state.finished) throw new Error("xiangqi: match already finished");
    if (seat !== state.turnSeat) throw new Error("xiangqi: wrong seat");
    if (!isLegalMove(state, move)) throw new Error("xiangqi: illegal move");

    const captured = state.board[move.to];
    const board = applyMoveToBoard(state.board, move);
    const opponent = 1 - seat;
    const decisiveReason = finishReason(board, opponent);
    const halfmoveClock = captured ? 0 : state.halfmoveClock + 1;
    const positionKey = boardPositionKey(board, opponent);
    const positionCount = (state.positionCounts[positionKey] ?? 0) + 1;
    const drawReason: XiangqiResultReason =
      positionCount >= 3
        ? "repetition"
        : halfmoveClock >= 120
          ? "no-capture"
          : null;
    const resultReason = decisiveReason ?? drawReason;
    const finished = resultReason !== null;

    return {
      state: {
        board,
        turnSeat: finished ? state.turnSeat : opponent,
        winnerSeat: decisiveReason ? seat : null,
        finished,
        resultReason,
        moveCount: state.moveCount + 1,
        halfmoveClock,
        positionCounts: {
          ...state.positionCounts,
          [positionKey]: positionCount,
        },
        lastMove: move,
        lastCaptured: captured,
        inCheck: !finished && isInCheck(board, opponent),
      },
      presentation: { move, captured },
    };
  },
};
