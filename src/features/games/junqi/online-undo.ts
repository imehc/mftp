import type { JunqiOnlineSnapshot } from "./online-controller";
import type { JunqiFrame } from "./online-protocol";
import type { JunqiState, Side } from "./types";

type UndoRequest = Extract<JunqiFrame, { t: "undo-request" }>;

type UndoFrame = Extract<JunqiFrame, { t: "undo-request" | "undo-response" }>;

export type UndoPending = {
  direction: "incoming" | "outgoing";
  request: UndoRequest;
};

export const UNDO_HISTORY_LIMIT = 100;

export function undoPlies(view: { turnSeat: Side }, seat: Side): 1 | 2 {
  return view.turnSeat === seat ? 2 : 1;
}

export function canRequestUndo(s: JunqiOnlineSnapshot): boolean {
  return Boolean(
    !s.end &&
    !s.pending &&
    !s.undo &&
    !s.rematch &&
    s.view?.phase === "playing" &&
    s.undoDepth >= undoPlies(s.view, s.localSeat),
  );
}

/** 真值历史仅存在房主，投影与网络都不持有此对象。 */
export class JunqiUndoHistory {
  private states: JunqiState[] = [];

  get depth() {
    return this.states.length;
  }

  record(before: JunqiState, after: JunqiState) {
    if (before.phase !== "playing" || after.ply !== before.ply + 1) return;
    this.states.push(before);
    if (this.states.length > UNDO_HISTORY_LIMIT) this.states.shift();
  }

  restore(plies: number, revision: number): JunqiState | null {
    const at = this.states.length - plies;
    if (at < 0 || plies < 1) return null;
    const state = this.states[at];
    this.states.length = at;
    // 回退棋规状态但不回退网络修订，避免旧动作重新生效。
    return { ...state, revision: revision + 1 };
  }

  clear() {
    this.states = [];
  }
}

interface UndoHooks {
  host: boolean;
  live(): boolean;
  snapshot(): JunqiOnlineSnapshot;
  envelope(): { v: 1; matchId: string; round: number };
  nextId(): number;
  publish(patch: Partial<JunqiOnlineSnapshot>): void;
  send(frame: JunqiFrame): Promise<boolean>;
  enqueue(work: () => Promise<void>): void;
  commit(plies: number): Promise<void>;
  timeout(): void;
}

/** 协商与房主动作队列共用串行入口，确认必须绑定原始局面。 */
export class JunqiUndoNegotiation {
  private sequence = 0;
  private approved = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly hooks: UndoHooks) {}

  private arm() {
    this.clear();
    this.timer = setTimeout(() => this.hooks.timeout(), 30_000);
  }

  clear() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  reset() {
    this.clear();
    this.sequence = 0;
  }

  private matches(request: UndoRequest, seat: Side): boolean {
    const s = this.hooks.snapshot();
    return Boolean(
      s.view?.phase === "playing" &&
      request.revision === s.view.revision &&
      request.plies === undoPlies(s.view, seat) &&
      request.plies <= s.undoDepth,
    );
  }

  request = () => {
    const s = this.hooks.snapshot();
    if (!this.hooks.live() || !canRequestUndo(s) || !s.view) return;
    const request: UndoRequest = {
      ...this.hooks.envelope(),
      t: "undo-request",
      requestId: this.hooks.nextId(),
      revision: s.view.revision,
      plies: undoPlies(s.view, s.localSeat),
    };
    this.hooks.publish({
      undo: { direction: "outgoing", request },
      undoNotice: null,
    });
    this.approved = false;
    this.arm();
    void this.hooks.send(request);
  };

  respond = (accept: boolean) => {
    const s = this.hooks.snapshot(),
      pending = s.undo;
    if (
      !this.hooks.live() ||
      s.end ||
      s.pending ||
      pending?.direction !== "incoming"
    )
      return;
    this.hooks.publish({ pending: true });
    this.hooks.enqueue(async () => {
      const valid =
        accept && this.matches(pending.request, (1 - s.localSeat) as Side);
      this.approved = valid;
      if (
        !(await this.hooks.send({
          ...pending.request,
          t: "undo-response",
          accept: valid,
        }))
      )
        return;
      if (!valid) {
        this.clear();
        this.hooks.publish({ undo: null, pending: false });
      } else if (this.hooks.host)
        await this.hooks.commit(pending.request.plies);
      // 访客同意后仍锁定，直到收到裁判的回退投影。
    });
  };

  async receive(frame: UndoFrame) {
    const s = this.hooks.snapshot();
    if (frame.t === "undo-request") {
      if (frame.requestId <= this.sequence) return;
      this.sequence = frame.requestId;
      if (
        s.pending ||
        s.undo ||
        s.rematch ||
        !this.matches(frame, (1 - s.localSeat) as Side)
      ) {
        await this.hooks.send({ ...frame, t: "undo-response", accept: false });
        return;
      }
      this.hooks.publish({
        undo: { direction: "incoming", request: frame },
        undoNotice: null,
      });
      this.approved = false;
      this.arm();
      return;
    }
    const pending = s.undo;
    if (
      pending?.direction !== "outgoing" ||
      pending.request.requestId !== frame.requestId ||
      pending.request.revision !== frame.revision ||
      pending.request.plies !== frame.plies ||
      !this.matches(pending.request, s.localSeat)
    )
      return;
    if (!frame.accept) {
      this.clear();
      this.hooks.publish({
        undo: null,
        undoNotice: { requestId: frame.requestId, kind: "declined" },
      });
    } else {
      this.approved = true;
      if (this.hooks.host) await this.hooks.commit(frame.plies);
    }
  }

  stateChanged(revision: number) {
    const pending = this.hooks.snapshot().undo;
    if (!pending || revision <= pending.request.revision) return;
    this.clear();
    this.hooks.publish({
      undo: null,
      ...(!this.approved && pending.direction === "outgoing"
        ? {
            undoNotice: {
              requestId: pending.request.requestId,
              kind: "stale" as const,
            },
          }
        : {}),
    });
  }
}
