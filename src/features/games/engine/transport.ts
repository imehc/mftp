/**
 * Phase 3 contract for online play. Nothing here is implemented yet —
 * the interface is defined now so games are written against it and the
 * deterministic `GameDefinition.applyMove` contract (moves-only sync).
 *
 * Planned model: turn-based lockstep. Both peers run the same
 * deterministic resolver; only `(seq, seat, move)` crosses the wire,
 * with a state hash per move to detect divergence early.
 */
import type { SeatIndex } from "./types";

export interface RemoteMove<M> {
  /** Monotonic move counter within the match; detects loss/duplication. */
  seq: number;
  seat: SeatIndex;
  move: M;
  /** Hash of the sender's post-move state, for divergence detection. */
  stateHash: string;
}

export interface MatchTransport<M> {
  readonly matchId: string;
  /** Seat assigned to this client. */
  readonly localSeat: SeatIndex;
  sendMove(move: RemoteMove<M>): Promise<void>;
  onRemoteMove(handler: (move: RemoteMove<M>) => void): () => void;
  onPeerPresence(handler: (connected: boolean) => void): () => void;
  close(): void;
}
