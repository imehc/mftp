import type { AppError } from "~/bindings";

import type { LocalController } from "../controllers";
import type { MatchRunner } from "../match";
import type { GameDefinition, MoveResolution } from "../types";
import type { MatchControlMessage } from "./protocol";
import type { OnlineMatchSession } from "./session";

export type NegotiationRequest = Extract<
  MatchControlMessage,
  { t: "undo-request" | "rematch-request" }
>;

export type NegotiationResponse = Extract<
  MatchControlMessage,
  { t: "undo-response" | "rematch-response" }
>;

export type OnlineTransport<M> = Pick<
  OnlineMatchSession<M>,
  | "localSeat"
  | "sendMove"
  | "sendControl"
  | "onRemoteMove"
  | "onControl"
  | "onClosed"
  | "onPeerPresence"
  | "close"
>;

export interface OnlineGame<S, M, P> {
  game: GameDefinition<S, M, P>;
  initialState(): S;
  hash(state: S): string;
}

export interface OnlineRound<S, M, P> {
  runner: MatchRunner<S, M, P>;
  local: LocalController<S, M>;
}

export type MatchEnd =
  "desync" | "send-failed" | "peer-left" | "connection-lost" | "timeout";

export interface OnlineMatchSnapshot<S, M, P> {
  round: number;
  revision: number;
  localSeat: number;
  match: OnlineRound<S, M, P>;
  pending: {
    direction: "incoming" | "outgoing";
    request: NegotiationRequest;
  } | null;
  committing: boolean;
  end: MatchEnd | null;
  error: AppError | null;
  notice: { id: number; kind: "undo" | "rematch" } | null;
}

export type Presentation<S, P> = (resolution: MoveResolution<S, P>) => void;
