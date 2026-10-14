import type { z } from "zod";

import { frontendError, toIpcError } from "~/lib/errors";
import type { AppError } from "~/types";

import {
  type CheckpointStorage,
  checkpointStorage,
} from "./checkpoint-storage";
import type { LocalController } from "./controllers";
import type { MatchHooks, MatchRunner, MoveResolvedInfo } from "./match";
import { registerGameResource } from "./session-registry";

export interface GameCheckpoint<Mode, State> {
  version: number;
  gameId: string;
  id: string;
  savedAt: number;
  mode: Mode;
  history: State[];
}

export interface LocalGameSession<State, Move, Presentation> {
  runner: MatchRunner<State, Move, Presentation>;
  local: LocalController<State, Move>;
  dispose?(): void;
}

interface GameSessionConfig<Mode, State, Move, Presentation> {
  gameId: string;
  checkpointVersion?: number;
  schema: z.ZodType<GameCheckpoint<Mode, State>>;
  create(
    mode: Mode,
    hooks: MatchHooks<State, Move, Presentation>,
    checkpoint: { id: string; history?: State[] },
  ): LocalGameSession<State, Move, Presentation>;
  online?(mode: Mode): boolean;
  exitOnline?(mode: Mode): Promise<void>;
}

interface SessionSnapshot<Mode, State, Move, Presentation> {
  status: "loading" | "ready" | "error";
  active: {
    id: string;
    mode: Mode;
    session: LocalGameSession<State, Move, Presentation> | null;
  } | null;
  saved: GameCheckpoint<Mode, State> | null;
  error: AppError | null;
  saving: boolean;
  savedAt: number | null;
  transitioning: boolean;
}

export class GameSessionStore<Mode, State, Move, Presentation> {
  private snapshot: SessionSnapshot<Mode, State, Move, Presentation> = {
    status: "loading",
    active: null,
    saved: null,
    error: null,
    saving: false,
    savedAt: null,
    transitioning: false,
  };
  private readonly listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private restored: GameCheckpoint<Mode, State> | undefined;
  private presentation:
    | ((
        info: MoveResolvedInfo<State, Move, Presentation>,
      ) => void | Promise<void>)
    | null = null;
  private visible = false;
  private foreground = true;
  private revision = 0;
  private pendingCheckpoint:
    { id: string; history: readonly State[] } | undefined;
  private disposed = false;
  private readonly unregister: () => void;

  constructor(
    private readonly config: GameSessionConfig<Mode, State, Move, Presentation>,
    private readonly storage: CheckpointStorage = checkpointStorage,
  ) {
    this.unregister = registerGameResource({
      foreground: (visible) => {
        this.foreground = visible;
        this.updateRunning();
      },
      dispose: () => this.dispose(),
    });
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(
    patch: Partial<SessionSnapshot<Mode, State, Move, Presentation>>,
  ): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  load = (): Promise<void> => {
    if (this.loading) return this.loading;
    if (this.snapshot.status === "ready" || this.disposed)
      return Promise.resolve();
    this.publish({ status: "loading", error: null });
    this.loading = this.storage
      .read(this.config.gameId)
      .then((value) => {
        if (this.disposed) return;
        if (value === undefined) {
          this.publish({ status: "ready", saved: null });
          return;
        }
        const parsed = this.config.schema.safeParse(value);
        if (!parsed.success) {
          this.publish({
            status: "error",
            error: frontendError(
              "games:checkpoint_invalid",
              "Invalid game checkpoint",
            ),
          });
          return;
        }
        this.publish({ status: "ready", saved: parsed.data });
      })
      .catch(() => {
        if (!this.disposed)
          this.publish({
            status: "error",
            error: frontendError(
              "games:checkpoint_read",
              "Game checkpoint read failed",
            ),
          });
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  };

  start = (mode: Mode): void => {
    if (
      this.disposed ||
      this.snapshot.status !== "ready" ||
      this.snapshot.saved ||
      this.snapshot.active ||
      this.snapshot.transitioning
    )
      return;
    this.restored = undefined;
    this.publish({
      active: { id: crypto.randomUUID(), mode, session: null },
      error: null,
      savedAt: null,
    });
  };

  restore = (): void => {
    const saved = this.snapshot.saved;
    if (
      !saved ||
      this.snapshot.active ||
      this.snapshot.transitioning ||
      this.disposed
    )
      return;
    this.restored = saved;
    this.publish({
      saved: null,
      active: { id: saved.id, mode: saved.mode, session: null },
      savedAt: saved.savedAt,
      error: null,
    });
  };

  ensureSession(): LocalGameSession<State, Move, Presentation> | null {
    const active = this.snapshot.active;
    if (!active || this.config.online?.(active.mode) || this.disposed)
      return null;
    if (active.session) return active.session;
    try {
      const session = this.config.create(
        active.mode,
        {
          onMoveResolved: (info) =>
            this.visible && this.foreground
              ? this.presentation?.(info)
              : undefined,
          onCheckpoint: (history) => this.save(active.id, history),
          onError: (error) =>
            this.publish({ error: toIpcError(error).payload }),
        },
        { id: active.id, history: this.restored?.history },
      );
      this.restored = undefined;
      this.publish({ active: { ...active, session }, error: null });
      this.save(active.id, session.runner.getCheckpoint());
      return session;
    } catch (error) {
      this.publish({ error: toIpcError(error).payload });
      return null;
    }
  }

  attach(
    presentation: (
      info: MoveResolvedInfo<State, Move, Presentation>,
    ) => void | Promise<void>,
    start: boolean,
  ): () => void {
    this.presentation = presentation;
    this.visible = true;
    this.updateRunning();
    if (start) this.snapshot.active?.session?.runner.start();
    return () => {
      if (this.presentation !== presentation) return;
      this.presentation = null;
      this.visible = false;
      this.updateRunning();
    };
  }

  private updateRunning(): void {
    const runner = this.snapshot.active?.session?.runner;
    if (this.visible && this.foreground && !this.snapshot.transitioning)
      runner?.resume();
    else runner?.pause();
  }

  private save(id: string, history: readonly State[]): void {
    const active = this.snapshot.active;
    if (this.disposed || !active || active.id !== id) return;
    if (this.snapshot.transitioning) {
      this.pendingCheckpoint = { id, history };
      return;
    }
    const revision = ++this.revision;
    const checkpoint: GameCheckpoint<Mode, State> = {
      version: this.config.checkpointVersion ?? 1,
      gameId: this.config.gameId,
      id,
      savedAt: Date.now(),
      mode: active.mode,
      history: [...history],
    };
    this.publish({ saving: true });
    void this.storage
      .write(this.config.gameId, checkpoint)
      .then(() => {
        if (
          this.disposed ||
          this.snapshot.active?.id !== id ||
          revision !== this.revision
        )
          return;
        const error =
          this.snapshot.error?.code === "games:checkpoint_write"
            ? null
            : this.snapshot.error;
        this.publish({ saving: false, savedAt: checkpoint.savedAt, error });
      })
      .catch(() => {
        if (
          this.disposed ||
          this.snapshot.active?.id !== id ||
          revision !== this.revision
        )
          return;
        this.publish({
          saving: false,
          error: frontendError(
            "games:checkpoint_write",
            "Game checkpoint write failed",
          ),
        });
      });
  }

  retrySave = (): void => {
    const active = this.snapshot.active;
    if (active && this.config.online?.(active.mode)) void this.exit();
    else if (active?.session)
      this.save(active.id, active.session.runner.getCheckpoint());
    else if (active) this.ensureSession();
    else if (this.snapshot.status === "error") void this.load();
  };

  exit = async (): Promise<boolean> => {
    if (this.snapshot.transitioning || this.disposed) return false;
    this.publish({ transitioning: true });
    this.updateRunning();
    const active = this.snapshot.active;
    const online = active && this.config.online?.(active.mode);
    try {
      if (online) await this.config.exitOnline?.(active.mode);
      else await this.storage.remove(this.config.gameId);
      if (this.disposed) return false;
      this.releaseActive();
      this.restored = undefined;
      this.revision++;
      this.publish({
        status: "ready",
        active: null,
        saved: null,
        error: null,
        saving: false,
        savedAt: null,
      });
      return true;
    } catch (cause) {
      this.publish({
        error: online
          ? toIpcError(cause).payload
          : frontendError(
              "games:checkpoint_delete",
              "Game checkpoint deletion failed",
            ),
      });
      return false;
    } finally {
      this.publish({ transitioning: false });
      this.updateRunning();
      const checkpoint = this.pendingCheckpoint;
      this.pendingCheckpoint = undefined;
      if (checkpoint) this.save(checkpoint.id, checkpoint.history);
    }
  };

  replace = async (mode: Mode): Promise<void> => {
    if (await this.exit()) this.start(mode);
  };

  private releaseActive(): void {
    const active = this.snapshot.active;
    active?.session?.runner.dispose();
    active?.session?.dispose?.();
    this.presentation = null;
    this.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unregister();
    this.revision++;
    const active = this.snapshot.active;
    if (active && this.config.online?.(active.mode))
      void this.config.exitOnline?.(active.mode).catch((cause) => {
        this.publish({ error: toIpcError(cause).payload });
      });
    this.releaseActive();
  }
}
