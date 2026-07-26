/**
 * One live online-match channel on top of the Rust `game_room` service.
 *
 * The Rust side is a dumb relay: everything game-specific crosses the
 * wire as an opaque JSON string. Two lanes share it — lockstep `move`
 * frames satisfying the MatchTransport contract (../transport.ts), and
 * match-control frames (undo / rematch negotiation) — so any turn-based
 * game gets both without touching Rust.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { gameRoomLeave, gameRoomSend } from "~/lib/ipc";
import type { GameRoomStatus } from "~/types";
import type { MatchTransport, RemoteMove } from "../transport";
import type { SeatIndex } from "../types";

/** Negotiations that ride alongside moves; both are request/response. */
export type MatchControlMessage =
  | { t: "undo-request"; atMove: number; plies: number }
  | { t: "undo-response"; accept: boolean; atMove: number; plies: number }
  | { t: "rematch-request" }
  | { t: "rematch-response"; accept: boolean };

type AppFrame<M> = { t: "move"; move: RemoteMove<M> } | MatchControlMessage;

export class OnlineMatchSession<M> implements MatchTransport<M> {
  readonly matchId: string;
  readonly localSeat: SeatIndex;
  readonly roomName: string;
  /** Updated if the peer (re)connects under a different name. */
  peerName: string;

  private readonly moveHandlers = new Set<(move: RemoteMove<M>) => void>();
  private readonly controlHandlers = new Set<
    (msg: MatchControlMessage) => void
  >();
  private readonly presenceHandlers = new Set<(connected: boolean) => void>();
  private readonly closedHandlers = new Set<(reason: string) => void>();
  private unlisteners: UnlistenFn[] = [];

  private constructor(status: GameRoomStatus) {
    this.matchId = status.roomId ?? "";
    this.localSeat = status.seat ?? 0;
    this.roomName = status.roomName ?? "";
    this.peerName = status.peerName ?? "";
  }

  /** Attach to the active room; listeners are live once this resolves. */
  static async create<M>(
    status: GameRoomStatus,
  ): Promise<OnlineMatchSession<M>> {
    const session = new OnlineMatchSession<M>(status);
    session.unlisteners = await Promise.all([
      listen<string>("game-room://message", (event) => {
        session.dispatch(event.payload);
      }),
      listen<{ connected: boolean; name: string | null }>(
        "game-room://peer",
        (event) => {
          if (event.payload.name) session.peerName = event.payload.name;
          for (const handler of session.presenceHandlers) {
            handler(event.payload.connected);
          }
        },
      ),
      listen<{ reason: string }>("game-room://closed", (event) => {
        for (const handler of session.closedHandlers) {
          handler(event.payload.reason);
        }
      }),
    ]);
    return session;
  }

  private dispatch(raw: string): void {
    let frame: AppFrame<M>;
    try {
      frame = JSON.parse(raw) as AppFrame<M>;
    } catch {
      return;
    }
    if (frame.t === "move") {
      for (const handler of this.moveHandlers) handler(frame.move);
    } else {
      for (const handler of this.controlHandlers) handler(frame);
    }
  }

  async sendMove(move: RemoteMove<M>): Promise<void> {
    const frame: AppFrame<M> = { t: "move", move };
    await gameRoomSend(JSON.stringify(frame));
  }

  async sendControl(msg: MatchControlMessage): Promise<void> {
    await gameRoomSend(JSON.stringify(msg));
  }

  onRemoteMove(handler: (move: RemoteMove<M>) => void): () => void {
    this.moveHandlers.add(handler);
    return () => this.moveHandlers.delete(handler);
  }

  onControl(handler: (msg: MatchControlMessage) => void): () => void {
    this.controlHandlers.add(handler);
    return () => this.controlHandlers.delete(handler);
  }

  onPeerPresence(handler: (connected: boolean) => void): () => void {
    this.presenceHandlers.add(handler);
    return () => this.presenceHandlers.delete(handler);
  }

  /** Guest side: the room itself is gone (host left / connection lost). */
  onClosed(handler: (reason: string) => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }

  /** Detach listeners. Does not leave the room. */
  close(): void {
    for (const unlisten of this.unlisteners) unlisten();
    this.unlisteners = [];
    this.moveHandlers.clear();
    this.controlHandlers.clear();
    this.presenceHandlers.clear();
    this.closedHandlers.clear();
  }

  async leaveRoom(): Promise<void> {
    try {
      await gameRoomLeave();
    } catch {
      // Already gone; leaving must never throw during teardown.
    }
  }
}

/**
 * djb2 over a stable serialization — the cheap divergence tripwire both
 * peers run after every applied move (see RemoteMove.stateHash).
 */
export function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
