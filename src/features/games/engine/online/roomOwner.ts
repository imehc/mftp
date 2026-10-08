import type { AppError, GameRoomStatus } from "~/bindings";
import { toIpcError } from "~/lib/errors";
import { gameRoomLeave } from "~/lib/ipc";

import type { MoveParser } from "./protocol";
import { OnlineMatchSession, registrationAborted } from "./session";

export interface OnlineRoomReady<M> {
  session: OnlineMatchSession<M>;
  status: GameRoomStatus;
}

interface RoomSnapshot<M> {
  busy: boolean;
  cancelling: boolean;
  hosting: GameRoomStatus | null;
  ready: OnlineRoomReady<M> | null;
  error: AppError | null;
}

interface Attempt<M> {
  abort: AbortController;
  session?: OnlineMatchSession<M>;
  status?: GameRoomStatus;
  offPresence?: () => void;
  offClosed?: () => void;
  cancellation?: Promise<void>;
}

// 取消 JS 等待不会停止 Rust worker。所有房间变更共用队列，旧请求
// 返回并完成条件清理后，新请求才可启动；不串行化对局消息与发现。
let lifecycleTail = Promise.resolve();
let cancelActive: (() => void) | undefined;
const pendingCleanup = new Set<string>();

function serialize(work: () => Promise<void>): Promise<void> {
  const result = lifecycleTail.then(work);
  lifecycleTail = result.catch(() => {});
  return result;
}

async function release(instanceId: string): Promise<void> {
  pendingCleanup.add(instanceId);
  await gameRoomLeave(instanceId);
  pendingCleanup.delete(instanceId);
}

export class RoomOwner<M> {
  private active = false;
  private attempt: Attempt<M> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: RoomSnapshot<M> = {
    busy: false,
    cancelling: false,
    hosting: null,
    ready: null,
    error: null,
  };
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<RoomSnapshot<M>>): void {
    if (!this.active) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate(): void {
    if (this.active) return;
    this.active = true;
    this.publish({
      busy: this.attempt !== null,
      cancelling: this.attempt !== null,
      hosting: null,
      ready: null,
    });
  }
  private current(attempt: Attempt<M>): boolean {
    return (
      this.active && this.attempt === attempt && !attempt.abort.signal.aborted
    );
  }
  private stopDelivery(attempt: Attempt<M>): void {
    attempt.abort.abort();
    attempt.offPresence?.();
    attempt.offClosed?.();
    attempt.session?.close();
  }
  private async cleanup(attempt: Attempt<M>): Promise<void> {
    this.stopDelivery(attempt);
    const id = attempt.status?.instanceId;
    if (id) {
      await release(id);
      attempt.status = undefined;
    }
  }
  private cancelForReplacement = () => {
    void this.cancel();
  };

  start(
    parseMove: MoveParser<M>,
    open: () => Promise<GameRoomStatus>,
  ): Promise<void> {
    // 同步门闩覆盖 React 尚未重渲染时的连续点击。
    if (!this.active || this.attempt || this.snapshot.busy)
      return Promise.resolve();
    cancelActive?.();
    cancelActive = this.cancelForReplacement;
    const attempt: Attempt<M> = { abort: new AbortController() };
    this.attempt = attempt;
    this.publish({
      busy: true,
      cancelling: false,
      error: null,
      hosting: null,
      ready: null,
    });
    return serialize(async () => {
      try {
        if (!this.current(attempt)) return;
        // 失败清理保留代次供重试，避免吞错后遗失后台房间。
        for (const id of pendingCleanup) await release(id);
        if (!this.current(attempt)) return;
        const session = await OnlineMatchSession.prepare(
          parseMove,
          attempt.abort.signal,
        );
        attempt.session = session;
        if (!this.current(attempt)) return;
        attempt.status = await open();
        if (!this.current(attempt)) return;
        session.bind(attempt.status);
        attempt.offClosed = session.onClosed(() => {
          if (this.current(attempt)) void this.cancel(registrationAborted());
        });

        const handOff = () => {
          if (!this.current(attempt) || session.isClosed || this.snapshot.ready)
            return;
          this.publish({
            ready: { session, status: session.status },
            hosting: null,
          });
          attempt.offPresence?.();
          attempt.offClosed?.();
        };

        if (attempt.status.phase === "hosting") {
          this.publish({ hosting: session.status });
          attempt.offPresence = session.onPeerPresence((connected) => {
            if (connected) handOff();
          });
          // onPeerPresence 会同步补发，交接后解除新返回的监听句柄。
          if (this.snapshot.ready) attempt.offPresence();
        } else handOff();
      } catch (error) {
        if (this.current(attempt))
          this.publish({ error: toIpcError(error).payload });
        this.stopDelivery(attempt);
      } finally {
        if (attempt.abort.signal.aborted || !this.active) {
          try {
            await this.cleanup(attempt);
          } catch (error) {
            if (this.attempt === attempt)
              this.publish({ error: toIpcError(error).payload });
            console.warn("Game room cleanup pending retry");
          }
          if (this.attempt === attempt) this.attempt = null;
          if (cancelActive === this.cancelForReplacement)
            cancelActive = undefined;
        }
        if (!this.attempt || this.attempt === attempt)
          this.publish({ busy: false });
      }
    });
  }

  cancel(error?: unknown): Promise<void> {
    const attempt = this.attempt;
    if (!attempt) return Promise.resolve();
    if (attempt.cancellation) return attempt.cancellation;
    this.stopDelivery(attempt);
    if (cancelActive === this.cancelForReplacement) cancelActive = undefined;
    this.publish({
      busy: true,
      cancelling: true,
      ready: null,
      error: error ? toIpcError(error).payload : null,
    });
    attempt.cancellation = serialize(async () => {
      try {
        await this.cleanup(attempt);
      } catch (failure) {
        if (this.attempt === attempt || !this.attempt)
          this.publish({ error: toIpcError(failure).payload });
        console.warn("Game room cleanup pending retry");
      } finally {
        if (this.attempt === attempt) this.attempt = null;
        if (!this.attempt)
          this.publish({ busy: false, cancelling: false, hosting: null });
      }
    });
    return attempt.cancellation;
  }

  dispose(): void {
    this.active = false;
    void this.cancel();
  }
}
