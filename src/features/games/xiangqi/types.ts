import type { Difficulty } from "../engine/ai";
import type { LocalGameInput } from "../engine/game-session-store";
import type { MatchHandle } from "../engine/match-handle";
import type { SeatIndex } from "../engine/types";

export const XIANGQI_GAME_ID = "xiangqi";
export const BOARD_ROWS = 10;
export const BOARD_COLS = 9;

export type PieceKind =
  "general" | "advisor" | "elephant" | "horse" | "rook" | "cannon" | "soldier";

export interface XiangqiPiece {
  side: SeatIndex;
  kind: PieceKind;
}

export interface XiangqiMove {
  from: number;
  to: number;
}

export type XiangqiResultReason =
  | "general-captured"
  | "checkmate"
  | "stalemate"
  | "repetition"
  | "no-capture"
  | null;

export interface XiangqiState {
  board: Array<XiangqiPiece | null>;
  turnSeat: SeatIndex;
  winnerSeat: SeatIndex | null;
  finished: boolean;
  resultReason: XiangqiResultReason;
  moveCount: number;
  halfmoveClock: number;
  positionCounts: Record<string, number>;
  lastMove: XiangqiMove | null;
  lastCaptured: XiangqiPiece | null;
  inCheck: boolean;
}

export interface XiangqiPresentation {
  move: XiangqiMove;
  captured: XiangqiPiece | null;
}

export type XiangqiMode =
  | { kind: "ai"; difficulty: Difficulty; localSeat: SeatIndex }
  | { kind: "hotseat" }
  | { kind: "online" };

export interface XiangqiHistoryPayload {
  mode: XiangqiMode["kind"];
  difficulty?: Difficulty;
  winnerSeat: SeatIndex | null;
  reason: Exclude<XiangqiResultReason, null>;
  moves: number;
  localSeat?: SeatIndex;
}

export interface XiangqiSession {
  runner: MatchHandle<XiangqiState, XiangqiMove>;
  local: LocalGameInput<XiangqiMove>;
}
