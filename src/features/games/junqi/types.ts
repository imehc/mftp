import type { Difficulty } from "../engine/ai";

export const JUNQI_GAME_ID = "junqi";

export type Side = 0 | 1;

export type JunqiVariant = "open" | "hidden" | "flip";

export const PIECE_COUNTS = {
  commander: 1,
  general: 1,
  division: 2,
  brigade: 2,
  regiment: 2,
  battalion: 2,
  company: 3,
  platoon: 3,
  engineer: 3,
  bomb: 2,
  mine: 3,
  flag: 1,
} as const;

export type PieceKind = keyof typeof PIECE_COUNTS;

export interface Piece {
  id: string;
  side: Side;
  kind: PieceKind;
}

export type Board = (Piece | null)[];

export interface JunqiLocalMode {
  kind: "ai";
  localSeat: Side;
  difficulty: Difficulty;
  variant: JunqiVariant;
}

export type JunqiMode =
  JunqiLocalMode | { kind: "online"; variant: JunqiVariant };

export type ResultReason =
  "flag" | "immobilized" | "concede" | "repetition" | "no-capture";

export type Step = { type: "move"; from: number; to: number };

export type JunqiMove =
  | Step
  | { type: "swap"; from: number; to: number }
  | { type: "arrange"; seed: number }
  | { type: "ready" }
  | { type: "flip"; at: number }
  | { type: "concede" };

export interface BaseState {
  board: Board;
  phase: "deployment" | "playing" | "finished";
  ready: [boolean, boolean];
  turnSeat: Side;
  winner: Side | null;
  reason: ResultReason | null;
  ply: number;
  revision: number;
  quiet: number;
  positions: Record<string, number>;
  lastMove: Step | null;
  lastAction: JunqiMove | null;
  lastCombat: "attacker" | "defender" | "both" | null;
}

export interface OpenState extends BaseState {
  variant: "open";
}

export type Knowledge = Record<string, PieceKind[]>;

export interface HiddenState extends BaseState {
  variant: "hidden";
  seed: number;
  flagShown: [boolean, boolean];
  knowledge: [Knowledge, Knowledge];
}

export interface FlipState extends BaseState {
  variant: "flip";
  seed: number;
  revealed: string[];
  sides: [Side, Side] | null;
}

export type JunqiState = OpenState | HiddenState | FlipState;

export function seatSide(state: JunqiState, seat: Side): Side | null {
  return state.variant === "flip" ? (state.sides?.[seat] ?? null) : seat;
}

export interface JunqiPresentation {
  moved: boolean;
  capture: boolean;
}

export interface JunqiHistoryPayload {
  variant: JunqiVariant;
  localSide: Side | null;
  mode: JunqiMode["kind"];
  winner: Side | null;
  reason: ResultReason;
  moves: number;
}

export const opponent = (side: Side): Side => (side === 0 ? 1 : 0);
