import { Chess, DEFAULT_POSITION, type Move, type Square } from "chess.js";

import type { GameDefinition } from "../engine/types";
import {
  CHESS_GAME_ID,
  type ChessMove,
  type ChessPresentation,
  type ChessResult,
  type ChessState,
  type ChessTurn,
} from "./types";

export const seatFor = (color: string) => (color === "w" ? 0 : 1);
export const positionKey = (chess: Chess) =>
  chess.fen().split(" ").slice(0, 4).join(" ");
export const halfMoves = (chess: Chess) => Number(chess.fen().split(" ")[4]);

export function repetitions(positions: readonly string[], key: string): number {
  return positions.reduce(
    (count, position) => count + Number(position === key),
    0,
  );
}

export function automaticResult(
  chess: Chess,
  positions: readonly string[],
): ChessResult | null {
  // 最后一着已将死时，不能被七十五步和棋覆盖。
  if (chess.isCheckmate()) return "checkmate";
  if (chess.isStalemate()) return "stalemate";
  if (chess.isInsufficientMaterial()) return "material";
  if (halfMoves(chess) >= 150) return "seventy-five";
  if (repetitions(positions, positionKey(chess)) >= 5) return "fivefold";
  return null;
}

export function createChessState(fen = DEFAULT_POSITION): ChessState {
  const chess = new Chess(fen);
  const positions = [positionKey(chess)];
  const result = automaticResult(chess, positions);
  return {
    fen: chess.fen(),
    positions,
    ply: 0,
    lastAction: null,
    result,
    winnerSeat: result === "checkmate" ? 1 - seatFor(chess.turn()) : null,
  };
}

export function nextPositions(
  state: ChessState,
  chess: Chess,
  move: Move,
): string[] {
  const rightsChanged = state.fen.split(" ")[2] !== chess.fen().split(" ")[2];
  const irreversible = move.piece === "p" || !!move.captured || rightsChanged;
  return [...(irreversible ? [] : state.positions), positionKey(chess)];
}

export function claimReason(
  state: ChessState,
  intended?: ChessTurn,
): "threefold" | "fifty" | null {
  if (state.result) return null;
  const chess = new Chess(state.fen);
  let positions = state.positions;
  if (intended) {
    try {
      const move = chess.move(intended);
      positions = nextPositions(state, chess, move);
    } catch {
      return null;
    }
    if (chess.isCheckmate()) return null;
  }
  if (repetitions(positions, positionKey(chess)) >= 3) return "threefold";
  if (halfMoves(chess) >= 100) return "fifty";
  return null;
}

export function legalTurns(state: ChessState, square?: Square): ChessTurn[] {
  if (state.result) return [];
  return new Chess(state.fen)
    .moves({ verbose: true, ...(square ? { square } : {}) })
    .map(turnFrom);
}

export function turnFrom(move: Move): ChessTurn {
  return {
    from: move.from,
    to: move.to,
    ...(move.promotion
      ? { promotion: move.promotion as ChessTurn["promotion"] }
      : {}),
  };
}

export function applyChessMove(
  state: ChessState,
  action: ChessMove,
  seat: number,
): { state: ChessState; presentation: ChessPresentation } {
  const chess = new Chess(state.fen);
  if (state.result || seat !== seatFor(chess.turn()))
    throw new Error("Invalid chess turn");
  if (action.type === "claim") {
    const result = claimReason(state, action.intended);
    if (!result) throw new Error("Invalid chess draw claim");
    return {
      state: { ...state, lastAction: action, result, winnerSeat: null },
      presentation: { move: null, capture: null, rook: null, san: "" },
    };
  }
  const move = chess.move(action);
  const positions = nextPositions(state, chess, move);
  const result = automaticResult(chess, positions);
  const rank = move.color === "w" ? "1" : "8";
  const rook = move.isKingsideCastle()
    ? { from: ("h" + rank) as Square, to: ("f" + rank) as Square }
    : move.isQueensideCastle()
      ? { from: ("a" + rank) as Square, to: ("d" + rank) as Square }
      : null;
  return {
    state: {
      fen: chess.fen(),
      positions,
      ply: state.ply + 1,
      lastAction: { type: "move", ...turnFrom(move) },
      result,
      winnerSeat: result === "checkmate" ? seat : null,
    },
    presentation: {
      move: turnFrom(move),
      capture: move.isEnPassant()
        ? ((move.to[0] + move.from[1]) as Square)
        : move.captured
          ? move.to
          : null,
      rook,
      san: move.san,
    },
  };
}

export const chessGame: GameDefinition<
  ChessState,
  ChessMove,
  ChessPresentation
> = {
  id: CHESS_GAME_ID,
  seatCount: 2,
  currentSeat: (state) =>
    state.result ? null : seatFor(new Chess(state.fen).turn()),
  winnerSeat: (state) => state.winnerSeat,
  isFinished: (state) => state.result !== null,
  applyMove: applyChessMove,
};
