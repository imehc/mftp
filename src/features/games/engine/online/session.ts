/**
 * 在 Rust 的 `game_room` 服务之上的一条实时联机对战通道。
 *
 * Rust 侧只是个哑中继：一切游戏相关的内容都以不透明 JSON 字符串
 * 过线。两条通道共用它 —— 满足 MatchTransport 契约（../transport.ts）
 * 的锁步 `move` 帧，以及对局控制帧（悔棋 / 重赛协商）—— 因此任何
 * 回合制游戏都能两者兼得，而无需改动 Rust。
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  GAME_ROOM_CLOSED,
  GAME_ROOM_MESSAGE,
  GAME_ROOM_PEER,
} from "~/lib/events";
import { gameRoomLeave, gameRoomSend } from "~/lib/ipc";
import type { GameRoomStatus } from "~/types";
import type { MatchTransport, RemoteMove } from "../transport";
import type { SeatIndex } from "../types";

/** 与走法并行的协商；二者皆为请求 / 响应。 */
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
  /** 对手以不同名字（重）连接时更新。 */
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

  /** 接入当前房间；本方法 resolve 后监听器即生效。 */
  static async create<M>(
    status: GameRoomStatus,
  ): Promise<OnlineMatchSession<M>> {
    const session = new OnlineMatchSession<M>(status);
    session.unlisteners = await Promise.all([
      listen<string>(GAME_ROOM_MESSAGE, (event) => {
        session.dispatch(event.payload);
      }),
      listen<{ connected: boolean; name: string | null }>(
        GAME_ROOM_PEER,
        (event) => {
          if (event.payload.name) session.peerName = event.payload.name;
          for (const handler of session.presenceHandlers) {
            handler(event.payload.connected);
          }
        },
      ),
      listen<{ reason: string }>(GAME_ROOM_CLOSED, (event) => {
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

  /** 访客侧：房间本身已消失（房主离开 / 连接丢失）。 */
  onClosed(handler: (reason: string) => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }

  /** 移除监听器。不会离开房间。 */
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
      // 已经不在了；拆除期间离开绝不能抛错。
    }
  }
}

/**
 * 对稳定序列化结果做 djb2 —— 这是双方每步应用后都运行的廉价
 * 分歧探测器（见 RemoteMove.stateHash）。
 */
export function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
