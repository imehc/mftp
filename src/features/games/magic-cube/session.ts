import { frontendError } from "~/lib/errors";
import type { AppError } from "~/types";

import {
  type CheckpointStorage,
  checkpointStorage,
} from "../engine/checkpoint-storage";
import { useGamesHistoryStore } from "../engine/history";
import { registerGameResource } from "../engine/session-registry";
import {
  checkpointState,
  type CubeCheckpoint,
  cubeCheckpointSchema,
  MAX_HISTORY,
} from "./checkpoint";
import {
  applyMove,
  createCube,
  inverseMove,
  isSolved,
  scrambleCube,
  validMove,
} from "./engine";
import type { CubeMove, CubeOrder, CubeRecord, CubeState } from "./types";

interface Snapshot {
  status: "loading" | "ready" | "error";
  data: CubeCheckpoint;
  cube: CubeState;
  saved: CubeCheckpoint | null;
  error: AppError | null;
  busy: boolean;
  elapsedMs: number;
}

function fresh(order: CubeOrder, challenge = false): CubeCheckpoint {
  return {
    version: 1,
    gameId: "magic-cube",
    id: crypto.randomUUID(),
    base: challenge ? scrambleCube(order) : createCube(order),
    moves: [],
    cursor: 0,
    offset: 0,
    elapsedMs: 0,
    challenge,
    started: false,
    completed: false,
    assisted: false,
  };
}

export class CubeSession {
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private pending: Promise<void> | null = null;
  private mounted = false;
  private foreground = true;
  private enabled = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private lastSave = 0;
  private revision = 0;
  private recordedId: string | null = null;
  private epoch = 0;
  private queue: CubeMove[] = [];
  private unregister: () => void;
  private presenter: ((move: CubeMove) => Promise<void>) | null = null;
  disposed = false;

  constructor(
    private storage: CheckpointStorage = checkpointStorage,
    private now = () => performance.now(),
    private record: (id: string, payload: CubeRecord) => void = (id, payload) =>
      useGamesHistoryStore.getState().addRecord({
        id,
        gameId: "magic-cube",
        finishedAt: Date.now(),
        payload,
      }),
  ) {
    const data = fresh(3);
    this.snapshot = {
      status: "loading",
      data,
      cube: data.base,
      saved: null,
      error: null,
      busy: false,
      elapsedMs: 0,
    };
    this.unregister = registerGameResource({
      foreground: (visible) => {
        this.tick();
        this.foreground = visible;
        this.updateClock();
      },
      dispose: () => this.dispose(),
    });
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  load = (): Promise<void> => {
    if (this.pending) return this.pending;
    if (this.disposed || this.snapshot.status === "ready")
      return Promise.resolve();
    this.publish({ status: "loading", error: null });
    this.pending = this.storage
      .read("magic-cube")
      .then((raw) => {
        if (this.disposed) return;
        if (raw === undefined) {
          this.publish({ status: "ready", saved: null });
          return;
        }
        const parsed = cubeCheckpointSchema.safeParse(raw);
        if (!parsed.success) {
          this.publish({
            status: "error",
            error: frontendError(
              "games:checkpoint_invalid",
              "Invalid cube checkpoint",
            ),
          });
        } else this.publish({ status: "ready", saved: parsed.data });
      })
      .catch(() => {
        if (!this.disposed)
          this.publish({
            status: "error",
            error: frontendError(
              "games:checkpoint_read",
              "Cube checkpoint read failed",
            ),
          });
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  };

  restore = (): void => {
    const saved = this.snapshot.saved;
    if (!saved || this.disposed) return;
    this.replace(saved);
  };

  discard = async (): Promise<void> => {
    if (this.disposed || this.snapshot.busy) return;
    this.publish({ busy: true });
    try {
      await this.storage.remove("magic-cube");
      if (!this.disposed) this.replace(fresh(3));
    } catch {
      if (!this.disposed)
        this.publish({
          busy: false,
          error: frontendError(
            "games:checkpoint_delete",
            "Cube checkpoint delete failed",
          ),
        });
    }
  };

  private replace(data: CubeCheckpoint): void {
    this.epoch++;
    this.queue = [];
    this.publish({
      data,
      cube: checkpointState(data),
      elapsedMs: data.elapsedMs,
      busy: false,
      saved: null,
      status: "ready",
      error: null,
    });
    this.updateClock();
    this.save();
  }

  newCube = (order: CubeOrder, challenge = false): void => {
    if (
      this.disposed ||
      this.snapshot.status !== "ready" ||
      this.snapshot.saved
    )
      return;
    this.replace(fresh(order, challenge));
  };

  attach(presenter: (move: CubeMove) => Promise<void>): () => void {
    this.presenter = presenter;
    this.mounted = true;
    this.updateClock();
    return () => {
      this.tick();
      this.mounted = false;
      this.presenter = null;
      this.queue = [];
      this.epoch++;
      this.publish({ busy: false });
      this.updateClock();
      this.save();
    };
  }

  setEnabled(enabled: boolean): void {
    this.tick();
    this.enabled = enabled;
    if (!enabled) this.queue = [];
    this.updateClock();
  }

  private canOperate(): boolean {
    return (
      !this.disposed &&
      this.mounted &&
      this.foreground &&
      this.enabled &&
      this.snapshot.status === "ready" &&
      !this.snapshot.saved &&
      !this.snapshot.data.completed
    );
  }

  turn = (move: CubeMove): void => {
    if (!this.canOperate() || !validMove(move, this.snapshot.cube.order))
      return;
    if (this.snapshot.busy) {
      if (this.queue.length < 6) this.queue.push(move);
      return;
    }
    const old = this.snapshot.data;
    let base = old.base;
    let moves = [...old.moves.slice(0, old.cursor), move];
    let offset = old.offset;
    if (moves.length > MAX_HISTORY) {
      base = applyMove(base, moves[0]);
      moves = moves.slice(1);
      offset++;
    }
    this.commit(
      { ...old, base, moves, offset, cursor: moves.length, started: true },
      applyMove(this.snapshot.cube, move),
      move,
    );
  };

  undo = (): void => {
    const { data } = this.snapshot;
    if (!this.canOperate() || this.snapshot.busy || data.cursor === 0) return;
    const move = inverseMove(data.moves[data.cursor - 1]);
    this.commit(
      { ...data, cursor: data.cursor - 1, assisted: true },
      applyMove(this.snapshot.cube, move),
      move,
    );
  };

  redo = (): void => {
    const { data } = this.snapshot;
    if (
      !this.canOperate() ||
      this.snapshot.busy ||
      data.cursor === data.moves.length
    )
      return;
    const move = data.moves[data.cursor];
    this.commit(
      { ...data, cursor: data.cursor + 1 },
      applyMove(this.snapshot.cube, move),
      move,
    );
  };

  private commit(data: CubeCheckpoint, cube: CubeState, move: CubeMove): void {
    this.tick();
    data.elapsedMs = this.snapshot.elapsedMs;
    data.completed = data.challenge && data.started && isSolved(cube);
    const epoch = this.epoch;
    // 先启动旧局面的表现，再发布已提交状态。离开/渲染失败只取消表现，不回退合法动作。
    let animation: Promise<void>;
    try {
      animation = this.presenter?.(move) ?? Promise.resolve();
    } catch {
      animation = Promise.resolve();
    }
    this.publish({ data, cube, busy: true });
    if (data.completed) {
      this.queue = [];
    }
    this.updateClock();
    this.save();
    void animation
      .catch(() => {})
      .then(() => {
        if (this.disposed || epoch !== this.epoch) return;
        this.publish({ busy: false });
        const next = this.queue.shift();
        if (next) this.turn(next);
      });
  }

  private running(): boolean {
    const { data } = this.snapshot;
    return (
      this.mounted &&
      this.foreground &&
      this.enabled &&
      !this.disposed &&
      data.challenge &&
      data.started &&
      !data.completed &&
      !this.snapshot.saved
    );
  }

  private tick = (): void => {
    const now = this.now();
    if (this.timer && this.running()) {
      const elapsedMs =
        this.snapshot.elapsedMs + Math.max(0, now - this.lastTick);
      this.publish({ elapsedMs, data: { ...this.snapshot.data, elapsedMs } });
      if (now - this.lastSave > 5000) this.save();
    }
    this.lastTick = now;
  };

  private updateClock(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.lastTick = this.now();
    if (this.running()) this.timer = setInterval(this.tick, 250);
  }

  save = (): void => {
    if (
      this.disposed ||
      this.snapshot.status !== "ready" ||
      this.snapshot.saved
    )
      return;
    const revision = ++this.revision;
    const checkpoint = {
      ...this.snapshot.data,
      elapsedMs: this.snapshot.elapsedMs,
    };
    if (checkpoint.completed && this.recordedId !== checkpoint.id) {
      try {
        this.record(checkpoint.id, {
          order: checkpoint.base.order,
          elapsedMs: checkpoint.elapsedMs,
          moves: checkpoint.offset + checkpoint.cursor,
          assisted: checkpoint.assisted,
        });
        this.recordedId = checkpoint.id;
        if (this.snapshot.error?.code === "magic-cube:history")
          this.publish({ error: null });
      } catch {
        this.publish({
          error: frontendError(
            "magic-cube:history",
            "Cube challenge history write failed",
          ),
        });
      }
    }
    this.lastSave = this.now();
    void this.storage
      .write("magic-cube", checkpoint)
      .then(() => {
        if (
          !this.disposed &&
          revision === this.revision &&
          this.snapshot.error?.code === "games:checkpoint_write"
        )
          this.publish({ error: null });
      })
      .catch(() => {
        if (!this.disposed && revision === this.revision)
          this.publish({
            error: frontendError(
              "games:checkpoint_write",
              "Cube checkpoint write failed",
            ),
          });
      });
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    this.queue = [];
    this.presenter = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unregister();
  }
}

let session: CubeSession | undefined;

export function getCubeSession(): CubeSession {
  if (!session || session.disposed) session = new CubeSession();
  return session;
}
