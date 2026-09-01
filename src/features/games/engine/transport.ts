/**
 * 联机对战的契约，由 `online/session.ts` 在 Rust 的 `game_room`
 * 中继之上实现，并通过 RemoteController 消费。
 *
 * 模型：回合制锁步。双方运行同一确定性解析器；只在线上传递
 * (seq, seat, move)，并为每步附带状态哈希以便尽早发现分歧。
 */
import type { SeatIndex } from "./types";

export interface RemoteMove<M> {
  /** 对局内单调递增的走法计数；用于检测丢失 / 重复。 */
  seq: number;
  seat: SeatIndex;
  move: M;
  /** 发送方走法后状态的哈希，用于分歧检测。 */
  stateHash: string;
}

export interface MatchTransport<M> {
  readonly matchId: string;
  /** 分配给本客户端的座位。 */
  readonly localSeat: SeatIndex;
  sendMove(move: RemoteMove<M>): Promise<void>;
  onRemoteMove(handler: (move: RemoteMove<M>) => void): () => void;
  onPeerPresence(handler: (connected: boolean) => void): () => void;
  close(): void;
}
