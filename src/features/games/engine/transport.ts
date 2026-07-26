/**
 * Contract for online play, implemented by `online/session.ts` on top of
 * the Rust `game_room` relay and consumed through `RemoteController`.
 *
 * Model: turn-based lockstep. Both peers run the same deterministic
 * resolver; only `(seq, seat, move)` crosses the wire, with a state hash
 * per move to detect divergence early.
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
