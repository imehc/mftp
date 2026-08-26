import type { Difficulty } from "../engine/ai";
import type { LocalController } from "../engine/controllers";
import type { MatchRunner } from "../engine/match";
import type { SeatIndex } from "../engine/types";

export const GO_GAME_ID = "go";

export const BOARD_SIZES = [9, 13, 19] as const;
export type BoardSize = (typeof BOARD_SIZES)[number];
export const DEFAULT_BOARD_SIZE: BoardSize = 19;

/** Komi under Chinese rules. When comparing areas directly, white's total gains 7.5 points. */
export const KOMI = 7.5;

export type Stone = SeatIndex | null;

/** A placement, or a pass. Two consecutive passes end the game. */
export type GoMove = { kind: "play"; row: number; col: number } | { kind: "pass" };

export interface GoState {
  boardSize: BoardSize;
  board: Stone[];
  turnSeat: SeatIndex;
  /** Intersection forbidden for the current turn (simple ko), else null. */
  koPoint: number | null;
  captures: [number, number];
  consecutivePasses: number;
  /** Board positions after each placement, for Chinese-rules superko
   *  (global repetition forbidden). Passes are not recorded. */
  positionHistory: string[];
  finished: boolean;
  winnerSeat: SeatIndex | null;
  /** Area (stones + surrounded empty) per seat once finished, else null. */
  finalScore: [number, number] | null;
  moveCount: number;
  lastMove: GoMove | null;
  /** Stones removed by the last move (index + seat), for animations. */
  lastCaptured: Array<{ index: number; seat: SeatIndex }>;
}

/** What the stage plays back after a move lands. */
export interface GoPresentation {
  move: GoMove;
  captured: Array<{ index: number; seat: SeatIndex }>;
}

export type GoMode =
  | { kind: "ai"; difficulty: Difficulty; localSeat: SeatIndex; boardSize: BoardSize }
  | { kind: "hotseat"; boardSize: BoardSize }
  | { kind: "online"; boardSize: BoardSize };

export interface GoHistoryPayload {
  mode: GoMode["kind"];
  difficulty?: Difficulty;
  boardSize: BoardSize;
  winnerSeat: SeatIndex | null;
  moves: number;
  score?: [number, number];
  localSeat?: SeatIndex;
}

/** A live match: the runner plus the controller local input feeds into. */
export interface GoSession {
  runner: MatchRunner<GoState, GoMove, GoPresentation>;
  local: LocalController<GoState, GoMove>;
}
