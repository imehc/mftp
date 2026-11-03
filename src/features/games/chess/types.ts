import type { Square } from "chess.js";

import type { Difficulty } from "../engine/ai";
import type { LocalGameInput } from "../engine/game-session-store";
import type { MatchHandle } from "../engine/match-handle";

export const CHESS_GAME_ID = "chess";

export type Promotion = "q" | "r" | "b" | "n";

export interface ChessTurn {
  from: Square;
  to: Square;
  promotion?: Promotion;
}

export type ChessMove =
  ({ type: "move" } & ChessTurn) | { type: "claim"; intended?: ChessTurn };

export type ChessResult =
  | "checkmate"
  | "stalemate"
  | "material"
  | "fivefold"
  | "seventy-five"
  | "threefold"
  | "fifty";

export interface ChessState {
  fen: string;
  /** 只保留最近一次不可逆着法之后的局面键；FEN 本身不包含重复历史。 */
  positions: string[];
  ply: number;
  lastAction: ChessMove | null;
  result: ChessResult | null;
  winnerSeat: number | null;
}

export interface ChessPresentation {
  move: ChessTurn | null;
  capture: Square | null;
  rook: { from: Square; to: Square } | null;
  san: string;
}

export type ChessMode =
  | { kind: "ai"; difficulty: Difficulty; localSeat: number }
  | { kind: "hotseat" | "online" };

export interface ChessHistoryPayload {
  mode: ChessMode["kind"];
  difficulty?: Difficulty;
  winnerSeat: number | null;
  result: ChessResult;
  moves: number;
  localSeat?: number;
}

export interface ChessSession {
  runner: MatchHandle<ChessState, ChessMove>;
  local: LocalGameInput<ChessMove>;
}

export type ChessView = "table" | "top";
