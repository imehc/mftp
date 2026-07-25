/**
 * Game-agnostic turn-based match framework.
 *
 * A game plugs in by implementing `GameDefinition` (pure, deterministic
 * state + move resolution) and, optionally, an `AiStrategy` (see ai.ts).
 * Who produces each move — a local human, an AI, or a remote peer — is
 * abstracted behind `PlayerController` (see controllers.ts), so the same
 * match loop drives practice, vs-AI, hot-seat, and (later) online play.
 */

/** Seat index within a match, 0-based. */
export type SeatIndex = number;

export type MatchPhase =
  /** Waiting for the active seat's controller to produce a move. */
  | "awaiting-move"
  /** A move is being applied / its presentation is playing back. */
  | "resolving"
  | "finished";

/**
 * Result of applying one move.
 *
 * `presentation` carries whatever the game's renderer needs to play the
 * move back (e.g. a physics frame timeline + impact events for billiards).
 * The engine never inspects it.
 */
export interface MoveResolution<S, P> {
  state: S;
  presentation: P;
}

/**
 * A turn-based game. Implementations MUST be deterministic: the same
 * (state, move, seat) always yields the same resolution. That property is
 * what lets AI evaluation reuse the live resolver and what will let online
 * play sync by exchanging moves only.
 */
export interface GameDefinition<S, M, P = unknown> {
  id: string;
  seatCount: number;
  /** Seat whose turn it is, or null when the game is over. */
  currentSeat(state: S): SeatIndex | null;
  /** Winning seat once finished; null while ongoing (or for a draw). */
  winnerSeat(state: S): SeatIndex | null;
  isFinished(state: S): boolean;
  applyMove(
    state: S,
    move: M,
    seat: SeatIndex,
  ): MoveResolution<S, P> | Promise<MoveResolution<S, P>>;
}

export interface MoveRequestContext<S> {
  state: S;
  seat: SeatIndex;
  /** Aborted when the match is disposed (unmount / restart). */
  signal: AbortSignal;
}

export type ControllerKind = "local" | "ai" | "remote";

/**
 * Produces moves for one seat. The match loop awaits `requestMove` each
 * time the seat becomes active; implementations resolve it from UI input
 * (LocalController), a strategy search (AiController), or the network
 * (RemoteController, phase 3).
 */
export interface PlayerController<S, M> {
  readonly kind: ControllerKind;
  requestMove(ctx: MoveRequestContext<S>): Promise<M>;
  dispose?(): void;
}
