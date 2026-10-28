import { frontendError } from "~/lib/errors";
import type { AppError } from "~/types";

import {
  type CheckpointStorage,
  checkpointStorage,
} from "../engine/checkpoint-storage";
import { useGamesHistoryStore } from "../engine/history";
import { registerGameResource } from "../engine/session-registry";
import {
  checkpointBoard,
  MAX_PUZZLE_HISTORY,
  type PuzzleCheckpoint,
  puzzleCheckpointSchema,
} from "./checkpoint";
import { canMove, isSolved, moveTile, scrambleBoard } from "./engine";
import {
  PUZZLE_ID,
  type PuzzleBoard,
  type PuzzleRecord,
  type PuzzleSize,
} from "./types";

interface Snapshot {
  status: "loading" | "ready" | "error";
  data: PuzzleCheckpoint;
  board: PuzzleBoard;
  saved: PuzzleCheckpoint | null;
  error: AppError | null;
  busy: boolean;
}

function fresh(initial: PuzzleBoard): PuzzleCheckpoint {
  return {
    version: 1,
    gameId: PUZZLE_ID,
    id: crypto.randomUUID(),
    initial,
    base: initial,
    moves: [],
    cursor: 0,
    offset: 0,
    elapsedMs: 0,
    started: false,
    completed: false,
    assisted: false,
  };
}

export class PuzzleSession {
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
  private unregister: () => void;
  disposed = false;

  constructor(
    private storage: CheckpointStorage = checkpointStorage,
    private now = () => performance.now(),
    private record: (id: string, payload: PuzzleRecord) => void = (
      id,
      payload,
    ) =>
      useGamesHistoryStore
        .getState()
        .addRecord({ id, gameId: PUZZLE_ID, finishedAt: Date.now(), payload }),
  ) {
    const data = fresh(scrambleBoard(4));
    this.snapshot = {
      status: "loading",
      data,
      board: data.base,
      saved: null,
      error: null,
      busy: false,
    };
    this.unregister = registerGameResource({
      foreground: (visible) => {
        this.tick();
        this.foreground = visible;
        this.updateClock();
        if (!visible) this.save();
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
      .read(PUZZLE_ID)
      .then((raw) => {
        if (this.disposed) return;
        if (raw === undefined) {
          this.publish({ status: "ready" });
          this.save();
        } else {
          const parsed = puzzleCheckpointSchema.safeParse(raw);
          if (parsed.success)
            this.publish({ status: "ready", saved: parsed.data });
          else
            this.publish({
              status: "error",
              error: frontendError(
                "games:checkpoint_invalid",
                "Invalid sliding puzzle checkpoint",
              ),
            });
        }
      })
      .catch(() => {
        if (!this.disposed)
          this.publish({
            status: "error",
            error: frontendError(
              "games:checkpoint_read",
              "Sliding puzzle checkpoint read failed",
            ),
          });
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  };

  restore = (): void => {
    if (this.snapshot.saved && !this.disposed && !this.snapshot.busy)
      this.replace(this.snapshot.saved);
  };

  discard = async (): Promise<void> => {
    if (
      this.disposed ||
      this.snapshot.busy ||
      this.snapshot.status === "loading"
    )
      return;
    this.publish({ busy: true });
    try {
      await this.storage.remove(PUZZLE_ID);
      if (!this.disposed) this.replace(fresh(scrambleBoard(4)));
    } catch {
      if (!this.disposed)
        this.publish({
          busy: false,
          error: frontendError(
            "games:checkpoint_delete",
            "Sliding puzzle checkpoint delete failed",
          ),
        });
    }
  };

  private replace(data: PuzzleCheckpoint): void {
    this.publish({
      status: "ready",
      data,
      board: checkpointBoard(data),
      saved: null,
      error: null,
      busy: false,
    });
    this.updateClock();
    this.save();
  }

  private ready(): boolean {
    return (
      !this.disposed &&
      this.snapshot.status === "ready" &&
      !this.snapshot.saved &&
      !this.snapshot.busy
    );
  }

  newGame = (size: PuzzleSize): void => {
    if (this.ready()) this.replace(fresh(scrambleBoard(size)));
  };

  restart = (): void => {
    if (this.ready()) this.replace(fresh(this.snapshot.data.initial));
  };

  attach(): () => void {
    this.mounted = true;
    this.updateClock();
    return () => {
      this.tick();
      this.mounted = false;
      this.updateClock();
      this.save();
    };
  }

  setEnabled(enabled: boolean): void {
    this.tick();
    this.enabled = enabled;
    this.updateClock();
    if (!enabled) this.save();
  }

  private canOperate(): boolean {
    return (
      this.ready() &&
      this.mounted &&
      this.foreground &&
      this.enabled &&
      !this.snapshot.data.completed
    );
  }

  move = (tile: number): boolean => {
    if (!this.canOperate() || !canMove(this.snapshot.board, tile)) return false;
    const old = this.snapshot.data;
    let base = old.base,
      offset = old.offset;
    let moves = [...old.moves.slice(0, old.cursor), tile];
    if (moves.length > MAX_PUZZLE_HISTORY) {
      base = moveTile(base, moves[0]);
      moves = moves.slice(1);
      offset++;
    }
    this.commit(
      { ...old, base, offset, moves, cursor: moves.length, started: true },
      tile,
    );
    return true;
  };

  undo = (): boolean => {
    const data = this.snapshot.data;
    if (!this.canOperate() || !data.cursor) return false;
    this.commit(
      { ...data, cursor: data.cursor - 1, assisted: true },
      data.moves[data.cursor - 1],
    );
    return true;
  };

  redo = (): boolean => {
    const data = this.snapshot.data;
    if (!this.canOperate() || data.cursor === data.moves.length) return false;
    this.commit({ ...data, cursor: data.cursor + 1 }, data.moves[data.cursor]);
    return true;
  };

  private commit(data: PuzzleCheckpoint, tile: number): void {
    this.tick();
    data.elapsedMs = this.snapshot.data.elapsedMs;
    const board = moveTile(this.snapshot.board, tile);
    data.completed = isSolved(board);
    this.publish({ data, board });
    this.updateClock();
    this.save();
  }

  private running(): boolean {
    return this.canOperate() && this.snapshot.data.started;
  }

  private tick = (): void => {
    const now = this.now();
    if (this.timer && this.running()) {
      const data = {
        ...this.snapshot.data,
        elapsedMs:
          this.snapshot.data.elapsedMs + Math.max(0, now - this.lastTick),
      };
      this.publish({ data });
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
    if (!this.ready()) return;
    const revision = ++this.revision;
    const checkpoint = this.snapshot.data;
    if (checkpoint.completed && this.recordedId !== checkpoint.id) {
      try {
        this.record(checkpoint.id, {
          size: checkpoint.initial.size,
          moves: checkpoint.offset + checkpoint.cursor,
          elapsedMs: checkpoint.elapsedMs,
          assisted: checkpoint.assisted,
        });
        this.recordedId = checkpoint.id;
        if (this.snapshot.error?.code === "sliding-puzzle:history")
          this.publish({ error: null });
      } catch {
        this.publish({
          error: frontendError(
            "sliding-puzzle:history",
            "Sliding puzzle history write failed",
          ),
        });
      }
    }
    this.lastSave = this.now();
    void this.storage
      .write(PUZZLE_ID, checkpoint)
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
              "Sliding puzzle checkpoint write failed",
            ),
          });
      });
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unregister();
  }
}

let session: PuzzleSession | undefined;

export function getPuzzleSession(): PuzzleSession {
  if (!session || session.disposed) session = new PuzzleSession();
  return session;
}
