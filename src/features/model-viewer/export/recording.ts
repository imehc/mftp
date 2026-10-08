import type { AppError, ModelExportAction } from "~/bindings";

import { modelError } from "../domain/errors";
import { exportError } from "./errors";
import { exportFileName } from "./file-name";
import { exportBlob } from "./native-export";
import {
  createRecordingEncoder,
  type RecordingEncoder,
} from "./recording-encoder";

export type RecordingResult = {
  blob: Blob;
  name: string;
  width: number;
  height: number;
};

type RecordingState = {
  status:
    | "idle"
    | "starting"
    | "recording"
    | "stopping"
    | "ready"
    | "saving"
    | "failed";
  seconds: number;
  result: RecordingResult | null;
  error: AppError | null;
  saved: boolean;
  shared: boolean;
};

type Job = {
  ready: Promise<RecordingEncoder>;
  pending: Promise<void> | null;
  finishing?: Promise<void>;
  discard: boolean;
  failure: unknown;
  start: number | null;
  last: number;
  frames: number;
  name: string;
  timer?: ReturnType<typeof setTimeout>;
};

export class ViewerRecording {
  private state: RecordingState = {
    status: "idle",
    seconds: 0,
    result: null,
    error: null,
    saved: false,
    shared: false,
  };
  private listeners = new Set<() => void>();
  private job: Job | null = null;
  private disposed = false;
  private saving: AbortController | null = null;
  private savePending: Promise<void> | null = null;

  constructor(
    private invalidate: () => void,
    private create = createRecordingEncoder,
  ) {}

  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(patch: Partial<RecordingState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  get active() {
    return this.state.status === "recording";
  }

  async start(width: number, height: number, name: string) {
    if (this.disposed || this.job || this.saving || this.state.result) return;
    this.publish({
      status: "starting",
      seconds: 0,
      error: null,
      saved: false,
      shared: false,
    });
    const job: Job = {
      ready: Promise.resolve().then(() => this.create(width, height)),
      pending: null,
      discard: false,
      failure: null,
      start: null,
      last: -Infinity,
      frames: 0,
      name,
    };
    this.job = job;
    try {
      const encoder = await job.ready;
      if (job.finishing) return;
      this.encoder = encoder;
      this.publish({ status: "recording" });
      job.timer = setTimeout(() => {
        void this.stop();
      }, 60_000);
      this.invalidate();
    } catch (error) {
      job.failure = error;
      await this.settle(job);
    }
  }

  /** 渲染任务内同步复制，编码繁忙时跳过帧，不积累画布副本或编码队列。 */
  frame(canvas: HTMLCanvasElement, time: number) {
    const job = this.job;
    if (!job || !this.active || job.pending || time - job.last < 1000 / 30)
      return;
    job.start ??= time;
    const seconds = (time - job.start) / 1000;
    if (seconds >= 60) {
      void this.stop();
      return;
    }
    job.last = time;
    // 编码器已经初始化；ready 的回调不能承担像素复制，否则可能读到清空的 WebGL 缓冲。
    const encoder = this.encoder;
    if (!encoder) return;
    try {
      const pending = encoder.add(canvas, seconds);
      job.frames++;
      job.pending = Promise.resolve(pending)
        .catch((error) => {
          job.failure = error;
        })
        .finally(() => {
          job.pending = null;
          if (job.failure) void this.settle(job);
        });
      const whole = Math.floor(seconds);
      if (whole !== this.state.seconds) this.publish({ seconds: whole });
    } catch (error) {
      job.failure = error;
      void this.settle(job);
    }
  }

  private encoder: RecordingEncoder | null = null;

  stop() {
    return this.job ? this.settle(this.job) : Promise.resolve();
  }

  private settle(job: Job): Promise<void> {
    if (job.finishing) return job.finishing;
    clearTimeout(job.timer);
    const duration =
      job.start === null
        ? 0
        : Math.min(
            60,
            Math.max(
              (performance.now() - job.start) / 1000,
              (job.last - job.start) / 1000 + 1 / 30,
            ),
          );
    this.publish({ status: "stopping" });
    job.finishing = (async () => {
      let encoder: RecordingEncoder | undefined;
      let released = false;
      let cleanupFailed = false;
      let result: RecordingResult | null = null;
      let failure = job.failure;
      try {
        encoder = await job.ready;
        await job.pending;
        failure = job.failure;
        if (job.discard || failure || !job.frames) {
          released = true;
          await encoder.cancel();
        } else {
          const blob = await encoder.finish(duration);
          released = true;
          failure = job.failure;
          if (!job.discard && !failure)
            result = {
              blob,
              name: exportFileName(job.name, encoder.extension),
              width: encoder.width,
              height: encoder.height,
            };
        }
      } catch (error) {
        failure = error;
        cleanupFailed = released;
        if (encoder && !released) {
          try {
            await encoder.cancel();
          } catch (cleanupError) {
            failure = cleanupError;
            cleanupFailed = true;
          }
        }
      } finally {
        this.job = null;
        this.encoder = null;
        this.publish({
          status:
            failure && (!job.discard || cleanupFailed)
              ? "failed"
              : result
                ? "ready"
                : "idle",
          result,
          error:
            failure && (!job.discard || cleanupFailed)
              ? exportError(failure, "recording_failed")
              : null,
        });
      }
    })();
    return job.finishing;
  }

  save(action: ModelExportAction = "save") {
    const result = this.state.result;
    if (!result || this.disposed || this.saving)
      return this.savePending ?? Promise.resolve();
    const task = new AbortController();
    this.saving = task;
    this.publish({
      status: "saving",
      error: null,
      saved: false,
      shared: false,
    });
    this.savePending = this.writeResult(result, task, action);
    return this.savePending;
  }

  private async writeResult(
    result: RecordingResult,
    task: AbortController,
    action: ModelExportAction,
  ) {
    try {
      const saved = await exportBlob(
        result.blob,
        result.name,
        action,
        task.signal,
      );
      if (!task.signal.aborted)
        this.publish({
          saved: saved === "saved",
          shared: saved === "presented",
        });
    } catch (error) {
      if (!task.signal.aborted)
        this.publish({ error: exportError(error, "recording_save") });
    } finally {
      this.saving = null;
      this.savePending = null;
      this.publish({
        status: this.disposed ? "idle" : "ready",
        result: this.disposed ? null : result,
      });
    }
  }

  discard() {
    if (!this.job && !this.saving)
      this.publish({
        status: "idle",
        result: null,
        error: null,
        saved: false,
        shared: false,
      });
  }

  interrupt() {
    if (this.job) {
      this.job.failure = modelError("recording_failed");
      return this.settle(this.job);
    }
    return Promise.resolve();
  }

  dispose() {
    this.disposed = true;
    this.saving?.abort();
    this.publish({ result: null });
    if (this.job) {
      this.job.discard = true;
      return this.settle(this.job);
    }
    return this.savePending ?? Promise.resolve();
  }
}
