/**
 * 在 Rust 的 `game_room` 服务之上的一条实时联机对战通道。
 *
 * Rust 侧只是个哑中继：一切游戏相关的内容都以不透明 JSON 字符串
 * 过线。两条通道共用它 —— 满足 MatchTransport 契约（../transport.ts）
 * 的锁步 `move` 帧，以及对局控制帧（悔棋 / 重赛协商）—— 因此任何
 * 回合制游戏都能两者兼得，而无需改动 Rust。
 */
import { msg } from "@lingui/core/macro";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  GameRoomClosedEvent,
  GameRoomClosedReason,
  GameRoomMessageEvent,
  GameRoomPeerEvent,
} from "~/bindings";
import { translate } from "~/i18n/translate";
import {
  GAME_ROOM_CLOSED,
  GAME_ROOM_MESSAGE,
  GAME_ROOM_PEER,
} from "~/lib/events";
import { gameRoomSend } from "~/lib/ipc";
import type { GameRoomStatus } from "~/types";

import type { MatchTransport, RemoteMove } from "../transport";
import type { SeatIndex } from "../types";
import {
  type AppFrame,
  type MatchControlMessage,
  type MoveParser,
  ONLINE_PROTOCOL_VERSION,
  parseFrame,
} from "./protocol";

export type { MatchControlMessage } from "./protocol";

// 仅缓冲监听已接入、但对局消费者尚未挂载的短暂窗口。
const MAX_PENDING_FRAMES = 128;

type SessionEvent =
  | { kind: "message"; event: GameRoomMessageEvent }
  | { kind: "peer"; event: GameRoomPeerEvent }
  | { kind: "closed"; event: GameRoomClosedEvent };

export function registrationAborted(): DOMException {
  return new DOMException(
    translate(msg`游戏房间连接已结束，请重新加入`),
    "AbortError",
  );
}

function disposeListener(unlisten: UnlistenFn): void {
  const failed = () => console.warn("Game room listener cleanup failed");
  try {
    // Tauri 的返回类型写作 void，实际解除函数会返回 Promise。
    void Promise.resolve(unlisten()).catch(failed);
  } catch {
    // 单个清理失败不能妨碍其他监听回收；回调本身仍会检查关闭状态。
    failed();
  }
}

export class OnlineMatchSession<M> implements MatchTransport<M> {
  private roomStatus: GameRoomStatus | null = null;
  private earlyEvents: SessionEvent[] = [];
  peerName = "";

  get status(): GameRoomStatus {
    if (!this.roomStatus) throw registrationAborted();
    return {
      ...this.roomStatus,
      peerName: this.connected ? this.peerName : null,
    };
  }
  get matchId(): string {
    return this.status.roomId ?? "";
  }
  get localSeat(): SeatIndex {
    return this.status.seat === 1 ? 1 : 0;
  }
  get roomName(): string {
    return this.status.roomName ?? "";
  }

  private readonly moveHandlers = new Set<(move: RemoteMove<M>) => void>();
  private readonly controlHandlers = new Set<
    (msg: MatchControlMessage) => void
  >();
  private readonly presenceHandlers = new Set<(connected: boolean) => void>();
  private readonly closedHandlers = new Set<
    (reason: GameRoomClosedReason) => void
  >();
  private unlisteners: UnlistenFn[] = [];
  private readonly stopped = new AbortController();
  private pending: AppFrame<M>[] = [];
  private flushing = false;
  private connected = false;
  private closedReason: GameRoomClosedReason | null = null;

  private constructor(private readonly parseMove: MoveParser<M>) {}

  /** 先接入监听，再启动后端请求；返回状态后按本机运行代次绑定。 */
  static async prepare<M>(
    parseMove: MoveParser<M>,
    signal?: AbortSignal,
  ): Promise<OnlineMatchSession<M>> {
    if (signal?.aborted) throw registrationAborted();
    const session = new OnlineMatchSession(parseMove);
    const stop = () => session.close();
    signal?.addEventListener("abort", stop, { once: true });

    let rejectStopped = () => {};

    const aborted = new Promise<never>((_, reject) => {
      rejectStopped = () => reject(registrationAborted());
      session.stopped.signal.addEventListener("abort", rejectStopped, {
        once: true,
      });
    });

    // 每个注册独立接收解除函数：Promise.all 先失败后，晚到的成功
    // 也必须立即清理，不能等一个已被丢弃的结果数组。
    const retain = (unlisten: UnlistenFn) => {
      if (session.isClosed) disposeListener(unlisten);
      else session.unlisteners.push(unlisten);
    };

    const registrations = Promise.all([
      Promise.resolve()
        .then(() =>
          listen<GameRoomMessageEvent>(GAME_ROOM_MESSAGE, (event) => {
            session.receive({ kind: "message", event: event.payload });
          }),
        )
        .then(retain),
      Promise.resolve()
        .then(() =>
          listen<GameRoomPeerEvent>(GAME_ROOM_PEER, (event) => {
            session.receive({ kind: "peer", event: event.payload });
          }),
        )
        .then(retain),
      Promise.resolve()
        .then(() =>
          listen<GameRoomClosedEvent>(GAME_ROOM_CLOSED, (event) => {
            session.receive({ kind: "closed", event: event.payload });
          }),
        )
        .then(retain),
    ]);
    try {
      await Promise.race([registrations, aborted]);
      if (session.isClosed) throw registrationAborted();
      return session;
    } catch (error) {
      session.close();
      throw error;
    } finally {
      signal?.removeEventListener("abort", stop);
      session.stopped.signal.removeEventListener("abort", rejectStopped);
    }
  }

  bind(status: GameRoomStatus): void {
    if (
      this.isClosed ||
      this.roomStatus ||
      !status.instanceId ||
      status.phase === "idle"
    )
      throw registrationAborted();
    this.roomStatus = status;
    this.peerName = status.peerName ?? "";
    this.connected = status.peerName !== null;
    const early = this.earlyEvents;
    this.earlyEvents = [];
    for (const event of early) this.receive(event);
    if (this.isClosed) throw registrationAborted();
  }

  private receive(message: SessionEvent): void {
    if (this.isClosed) return;
    if (!this.roomStatus) {
      // IPC 尚未返回时保留首帧；绑定后丢弃旧运行代次的排队事件。
      if (this.earlyEvents.length >= MAX_PENDING_FRAMES)
        this.terminate("connection-lost");
      else this.earlyEvents.push(message);
      return;
    }
    if (message.event.instanceId !== this.roomStatus.instanceId) return;
    if (message.kind === "message") this.dispatch(message.event.payload);
    else if (message.kind === "closed") this.terminate(message.event.reason);
    else {
      this.connected = message.event.connected;
      if (message.event.name !== null) this.peerName = message.event.name;
      for (const handler of this.presenceHandlers) handler(this.connected);
    }
  }

  get isClosed(): boolean {
    return this.stopped.signal.aborted;
  }

  private dispatch(raw: string): void {
    const frame = parseFrame(raw, this.parseMove);
    if (frame === null) return;
    if (this.pending.length >= MAX_PENDING_FRAMES) {
      this.terminate("connection-lost");
      return;
    }
    this.pending.push(frame);
    this.flushPending();
  }

  private flushPending(): void {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (!this.isClosed && this.pending.length > 0) {
        const frame = this.pending[0];
        // 保持走法与协商帧的共同顺序，等待相应消费者接入再交付。
        if (frame.t === "move") {
          if (this.moveHandlers.size === 0) return;
          this.pending.shift();
          for (const handler of [...this.moveHandlers]) handler(frame.move);
        } else {
          if (this.controlHandlers.size === 0) return;
          this.pending.shift();
          for (const handler of [...this.controlHandlers]) handler(frame);
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private terminate(reason: GameRoomClosedReason): void {
    const handlers = [...this.closedHandlers];
    this.closedReason = reason;
    this.close();
    for (const handler of handlers) handler(reason);
  }

  async sendMove(move: RemoteMove<M>): Promise<void> {
    if (this.isClosed) throw registrationAborted();
    const frame: AppFrame<M> = { v: ONLINE_PROTOCOL_VERSION, t: "move", move };
    await gameRoomSend(this.status.instanceId!, JSON.stringify(frame));
  }

  async sendControl(msg: MatchControlMessage): Promise<void> {
    if (this.isClosed) throw registrationAborted();
    await gameRoomSend(this.status.instanceId!, JSON.stringify(msg));
  }

  onRemoteMove(handler: (move: RemoteMove<M>) => void): () => void {
    if (this.isClosed) return () => {};
    this.moveHandlers.add(handler);
    this.flushPending();
    return () => this.moveHandlers.delete(handler);
  }

  onControl(handler: (msg: MatchControlMessage) => void): () => void {
    if (this.isClosed) return () => {};
    this.controlHandlers.add(handler);
    this.flushPending();
    return () => this.controlHandlers.delete(handler);
  }

  onPeerPresence(handler: (connected: boolean) => void): () => void {
    if (this.isClosed) return () => {};
    this.presenceHandlers.add(handler);
    handler(this.connected);
    return () => this.presenceHandlers.delete(handler);
  }

  /** 访客侧：房间本身已消失（房主离开 / 连接丢失）。 */
  onClosed(handler: (reason: GameRoomClosedReason) => void): () => void {
    if (this.closedReason !== null) {
      handler(this.closedReason);
      return () => {};
    }
    if (this.isClosed) return () => {};
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }

  /** 移除监听器。不会离开房间。 */
  close(): void {
    if (this.isClosed) return;
    this.stopped.abort();
    for (const unlisten of this.unlisteners) disposeListener(unlisten);
    this.unlisteners = [];
    this.pending = [];
    this.earlyEvents = [];
    this.moveHandlers.clear();
    this.controlHandlers.clear();
    this.presenceHandlers.clear();
    this.closedHandlers.clear();
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
