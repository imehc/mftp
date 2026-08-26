/** Billiards-specific state, move, and presentation types. */
import type { Difficulty } from "../engine/ai";
import type { SeatIndex } from "../engine/types";

export const BILLIARDS_GAME_ID = "billiards";

export type BilliardsMode =
  | { kind: "practice" }
  | { kind: "ai"; difficulty: Difficulty; playerBreaks: boolean }
  | { kind: "hotseat" };

export interface BilliardsHistoryPayload {
  mode: BilliardsMode["kind"];
  difficulty?: Difficulty;
  winnerSeat: number | null;
  shots: number;
  fouls: number[];
}

export type BilliardsVariant = "eight-ball" | "practice";
export type BallGroup = "solids" | "stripes";

/** Ball ids: 0 = cue, 1-7 solids, 8 = eight, 9-15 stripes. */
export interface BallState {
  id: number;
  x: number;
  y: number;
  potted: boolean;
}

export type FoulReason =
  | "cue-potted"
  | "no-contact"
  | "wrong-first-contact"
  | "potted-eight-early";

export interface ShotOutcome {
  foul: FoulReason | null;
  /** Ball ids potted by the shot, in pocket order (cue excluded). */
  potted: number[];
  /** Shooter keeps the table for the next shot. */
  continueTurn: boolean;
  /** The 8 was potted on the break and put back on the foot spot. */
  respottedEight: boolean;
}

export interface BilliardsState {
  variant: BilliardsVariant;
  balls: BallState[];
  turnSeat: SeatIndex;
  /** Assigned group per seat; null until the table is "closed". */
  groups: (BallGroup | null)[];
  openTable: boolean;
  breakDone: boolean;
  ballInHand: boolean;
  winnerSeat: SeatIndex | null;
  finished: boolean;
  /** Number of shots taken so far (cue placements excluded). */
  shotCount: number;
  /** Cumulative fouls per seat, for the settlement screen. */
  foulCounts: number[];
  /** Outcome of the previous shot, for HUD messaging. */
  lastOutcome: ShotOutcome | null;
}

export type BilliardsMove =
  | {
      type: "shot";
      /** Aim angle in radians (table coordinates). */
      angle: number;
      /** 0..1, scaled to MAX_SHOT_SPEED. */
      power: number;
      /** Follow/draw spin: -1 (draw) .. 1 (follow). */
      followDraw: number;
    }
  | { type: "place-cue"; x: number; y: number };

/** One recorded simulation step (positions of every unpotted ball). */
export interface SimFrame {
  /** Simulation time in seconds since the shot. */
  t: number;
  /** Flat [id, x, y, ...] triplets — compact enough to record per step. */
  balls: number[];
}

export type SimEvent =
  | { type: "ball-ball"; t: number; a: number; b: number; impact: number }
  | { type: "cushion"; t: number; ball: number; impact: number }
  | { type: "pocket"; t: number; ball: number; pocket: number };

export interface BilliardsPresentation {
  frames: SimFrame[];
  events: SimEvent[];
}

export function ballGroup(id: number): BallGroup | "eight" | "cue" {
  if (id === 0) return "cue";
  if (id === 8) return "eight";
  return id < 8 ? "solids" : "stripes";
}

export function remainingGroupBalls(
  state: BilliardsState,
  group: BallGroup,
): number {
  return state.balls.filter(
    (ball) => !ball.potted && ball.id !== 0 && ball.id !== 8 && ballGroup(ball.id) === group,
  ).length;
}
