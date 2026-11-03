import type { z } from "zod";

import { frontendError, toIpcError } from "~/lib/errors";
import type { TaskInterruptionSource } from "~/lib/task-interruption";
import type { AppError } from "~/types";

import {
  type CheckpointStorage,
  checkpointStorage,
} from "./checkpoint-storage";
import type { MatchHooks, MatchRunner, MoveResolvedInfo } from "./match";
import { createMatchHandle, type MatchHandle } from "./match-handle";
import type { ParticipantConfiguration } from "./participants";
import { registerGameResource } from "./session-registry";

export interface GameCheckpoint<Mode, State> {
  version: number;
  gameId: string;
  id: string;
  savedAt: number;
  mode: Mode;
  history: State[];
  participants?: ParticipantConfiguration;
  rulesVersion?: number;
}

export interface LocalGameInput<Move> {
  readonly awaitingInput: boolean;
  submit(move: Move): boolean;
}

export interface LocalGameSession<
  State,
  Move,
  _Presentation,
  Observation = State,
> {
  restored?: boolean;
  runner: MatchHandle<Observation, Move>;
  local: LocalGameInput<Move>;
  /** 需要异步准备对局资源（如物理引擎）的实现提供该钩子；失败后可重试。 */
  ready?(): Promise<void>;
  dispose?(): void;
}

interface AuthorityGameSession<
  State,
  Move,
  Presentation,
  Observation,
> extends Omit<
  LocalGameSession<State, Move, Presentation, Observation>,
  "runner"
> {
  runner: MatchRunner<State, Move, Presentation, Observation>;
  /** 游戏显式提供只读控制投影，不传原始策略或任务对象。 */
  extensions?: Record<string, unknown>;
}

interface GameSessionConfig<Mode, State, Move, Presentation, Observation> {
  gameId: string;
  checkpointVersion?: number;
  schema: z.ZodType<GameCheckpoint<Mode, State>>;
  create(
    mode: Mode,
    hooks: MatchHooks<State, Move, Presentation, Observation>,
    checkpoint: {
      id: string;
      history?: State[];
      participants?: ParticipantConfiguration;
      rulesVersion?: number;
    },
  ): AuthorityGameSession<State, Move, Presentation, Observation>;
  online?(mode: Mode): boolean;
  exitOnline?(mode: Mode): Promise<void>;
}

interface SessionSnapshot<Mode, State, Move, Presentation, Observation> {
  status: "loading" | "ready" | "error";
  active: {
    id: string;
    mode: Mode;
    session: LocalGameSession<State, Move, Presentation, Observation> | null;
  } | null;
  saved:
    | (Omit<GameCheckpoint<Mode, State>, "history"> & { moveCount: number })
    | null;
  error: AppError | null;
  saving: boolean;
  savedAt: number | null;
  transitioning: boolean;
}

export class GameSessionStore<
  Mode,
  State,
  Move,
  Presentation,
  Observation = State,
> {
  private snapshot: SessionSnapshot<
    Mode,
    State,
    Move,
    Presentation,
    Observation
  > = {
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
  private savedCheckpoint: GameCheckpoint<Mode, State> | undefined;
  private authoritySession:
    AuthorityGameSession<State, Move, Presentation, Observation> | undefined;
  private presentation:
    | ((
        info: MoveResolvedInfo<Observation, Move, Presentation>,
      ) => void | Promise<void>)
    | null = null;
  private visible = false;
  private foreground = true;
  private foregroundStopSource: TaskInterruptionSource = "appHidden";
  private revision = 0;
  private pendingCheckpoint:
    { id: string; history: readonly State[] } | undefined;
  private disposed = false;
  private readonly unregister: () => void;

  constructor(
    private readonly config: GameSessionConfig<
      Mode,
      State,
      Move,
      Presentation,
      Observation
    >,
    private readonly storage: CheckpointStorage = checkpointStorage,
  ) {
    this.unregister = registerGameResource({
      foreground: (visible, source) => {
        this.foreground = visible;
        this.foregroundStopSource = source ?? "appHidden";
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
    patch: Partial<
      SessionSnapshot<Mode, State, Move, Presentation, Observation>
    >,
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
          this.savedCheckpoint = undefined;
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
        this.savedCheckpoint = parsed.data;
        const { history, ...metadata } = parsed.data;
        this.publish({
          status: "ready",
          saved: { ...metadata, moveCount: history.length - 1 },
        });
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
    const saved = this.savedCheckpoint;
    if (
      !saved ||
      this.snapshot.active ||
      this.snapshot.transitioning ||
      this.disposed
    )
      return;
    this.restored = saved;
    this.savedCheckpoint = undefined;
    this.publish({
      saved: null,
      active: { id: saved.id, mode: saved.mode, session: null },
      savedAt: saved.savedAt,
      error: null,
    });
  };

  ensureSession(): LocalGameSession<
    State,
    Move,
    Presentation,
    Observation
  > | null {
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
        {
          id: active.id,
          history: this.restored?.history,
          participants: this.restored?.participants,
          rulesVersion: this.restored?.rulesVersion,
        },
      );
      session.restored = this.restored !== undefined;
      this.restored = undefined;
      this.authoritySession = session;
      const publicSession: LocalGameSession<
        State,
        Move,
        Presentation,
        Observation
      > = {
        ...session.extensions,
        runner: createMatchHandle(session.runner),
        local: {
          submit: (move) => session.runner.submitLocal(move),
          get awaitingInput() {
            return session.runner.awaitingLocalInput;
          },
        },
        ready: session.ready,
        dispose: session.dispose,
        restored: session.restored,
      };
      this.publish({
        active: { ...active, session: publicSession },
        error: null,
      });
      this.save(active.id, session.runner.getAuthorityCheckpoint());
      return publicSession;
    } catch (error) {
      this.publish({ error: toIpcError(error).payload });
      return null;
    }
  }

  attach(
    presentation: (
      info: MoveResolvedInfo<Observation, Move, Presentation>,
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
    else
      this.authoritySession?.runner.pause(
        false,
        !this.foreground
          ? this.foregroundStopSource
          : this.snapshot.transitioning
            ? "transition"
            : "viewDetached",
      );
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
      rulesVersion: this.authoritySession?.runner.rulesVersion ?? 1,
      ...(this.authoritySession?.runner.getAuthorityConfiguration()
        ? {
            participants:
              this.authoritySession.runner.getAuthorityConfiguration(),
          }
        : {}),
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
    else if (active && this.authoritySession)
      this.save(
        active.id,
        this.authoritySession.runner.getAuthorityCheckpoint(),
      );
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
      this.savedCheckpoint = undefined;
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
    this.authoritySession = undefined;
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
