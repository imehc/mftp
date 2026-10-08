import { toIpcError, type IpcError } from "~/lib/errors";
import { MissingResources } from "../domain/errors";
import type { ImportProgress, ModelHandle, ModelSource } from "../domain/types";
import { loadModel } from "../loaders/registry";
import { modelFormat } from "../domain/formats";
import { ModelViewerRuntime } from "./viewer";
import type { ModelInspection } from "../domain/inspection";

export type ImportRequest = {
  name: string;
  size?: number;
  open: () => Promise<ModelSource> | ModelSource;
  libraryId?: string;
  loaded?: (runtime: ModelViewerRuntime, id: string) => void;
};

export type ModelItem = {
  id: string;
  libraryId?: string;
  name: string;
  size: number;
  format: string;
  status:
    | "queued"
    | "reading"
    | "decoding"
    | "uploading"
    | "missing"
    | "ready"
    | "error"
    | "cancelling"
    | "cancelled";
  visible: boolean;
  position: number[];
  error: IpcError | null;
  missing: string[];
};

export interface ViewerState {
  items: ModelItem[];
  selected: string | null;
  model:
    | (Pick<ModelHandle, "name" | "size" | "format" | "hasGeometry"> & {
        previewOnly: boolean;
      })
    | null;
  inspection: ModelInspection | null;
  progress: ImportProgress | null;
  missing: string[];
  awaitingId: string | null;
  error: IpcError | null;
  cancelling: boolean;
  context: "ready" | "lost" | "unavailable";
}

type Pending = {
  id: string;
  factory: ImportRequest["open"] | null;
  source: ModelSource | null;
  abort: AbortController;
  running: boolean;
  removed: boolean;
  complete: () => void;
  loaded?: ImportRequest["loaded"];
};

export class ViewerSession {
  private pending = new Map<string, Pending>();
  private queue: Pending[] = [];
  private draining = false;
  private disposed = false;
  private sequence = 0;
  revision = 0;
  private listeners = new Set<() => void>();
  private state: ViewerState = {
    items: [],
    selected: null,
    model: null,
    inspection: null,
    progress: null,
    missing: [],
    awaitingId: null,
    error: null,
    cancelling: false,
    context: "ready",
  };
  runtime: ModelViewerRuntime | null = null;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private update(value: Partial<ViewerState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => listener());
  }
  private item(id: string, patch: Partial<ModelItem>) {
    this.update({
      items: this.state.items.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
    this.syncPending();
  }
  private syncPending() {
    const missing = this.state.items.find((item) => item.status === "missing");
    this.update({
      missing: missing?.missing ?? [],
      awaitingId: missing?.id ?? null,
      cancelling: this.state.items.some((item) => item.status === "cancelling"),
    });
  }
  syncModels = () => {
    const collection = this.runtime?.models;
    if (!collection) return;
    const current = collection.current;
    this.update({
      selected: collection.selected,
      model: current
        ? {
            name: current.handle.name,
            size: current.handle.size,
            format: current.handle.format,
            hasGeometry: current.handle.hasGeometry,
            previewOnly: !current.handle.archive,
          }
        : null,
      inspection: current?.inspection.snapshot ?? null,
      items: this.state.items.map((item) => {
        const entry = collection.entries.get(item.id);
        return entry
          ? {
              ...item,
              visible: entry.layer.visible,
              position: entry.layer.position.toArray(),
            }
          : item;
      }),
    });
  };
  report(error: unknown) {
    this.update({ error: toIpcError(error) });
  }
  connect(host: HTMLDivElement) {
    this.disposed = false;
    const canvas = document.createElement("canvas");
    canvas.className = "size-full rounded-xl";
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);
    try {
      this.runtime = new ModelViewerRuntime(
        canvas,
        (lost) => this.update({ context: lost ? "lost" : "ready" }),
        this.syncModels,
      );
      this.update({
        context: "ready",
        items: [],
        model: null,
        inspection: null,
        selected: null,
      });
    } catch {
      canvas.remove();
      this.update({ context: "unavailable" });
    }
  }
  open(factory: ImportRequest["open"]) {
    return this.enqueue([{ name: "", open: factory }]);
  }
  enqueue(requests: ImportRequest[]) {
    if (this.disposed || !this.runtime) return Promise.resolve();
    this.revision++;
    const done = requests.map((request) => {
      const id = `model-${++this.sequence}`;

      let complete = () => {};

      const promise = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const pending: Pending = {
        id,
        factory: request.open,
        source: null,
        abort: new AbortController(),
        running: false,
        removed: false,
        complete,
        loaded: request.loaded,
      };
      this.pending.set(id, pending);
      this.queue.push(pending);
      this.update({
        items: [
          ...this.state.items,
          {
            id,
            libraryId: request.libraryId,
            name: request.name,
            size: request.size ?? 0,
            format: modelFormat(request.name),
            status: "queued",
            visible: true,
            position: [0, 0, 0],
            error: null,
            missing: [],
          },
        ],
        error: null,
      });
      return promise;
    });
    void this.drain();
    return Promise.all(done).then(() => {});
  }
  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const pending = this.queue.shift()!;
        if (!pending.abort.signal.aborted && !this.disposed)
          await this.run(pending);
        else pending.complete();
      }
    } finally {
      this.draining = false;
      this.update({ progress: null });
    }
  }
  private async close(pending: Pending) {
    const source = pending.source;
    pending.source = null;
    pending.factory = null;
    try {
      await source?.close();
    } catch (error) {
      // 清理失败保留诊断，不自动重放原生写操作。
      this.item(pending.id, { error: toIpcError(error) });
      this.report(error);
    }
    this.pending.delete(pending.id);
  }
  private async run(pending: Pending) {
    const runtime = this.runtime;
    if (!runtime) return;
    pending.running = true;
    this.item(pending.id, { status: "reading", error: null, missing: [] });
    this.update({
      progress: {
        phase: "reading",
        name: this.state.items.find((item) => item.id === pending.id)?.name,
      },
    });
    let handle: ModelHandle | null = null,
      keepSource = false;
    try {
      if (!pending.source && pending.factory)
        pending.source = await pending.factory();
      pending.factory = null;
      pending.abort.signal.throwIfAborted();
      if (!pending.source) return;
      this.item(pending.id, {
        name: pending.source.name,
        size: pending.source.size,
        format: modelFormat(pending.source.name),
      });
      handle = await loadModel(
        pending.source,
        runtime.renderer,
        pending.abort.signal,
        (progress) => {
          if (pending.abort.signal.aborted || this.disposed) return;
          this.item(pending.id, { status: progress.phase });
          this.update({ progress });
        },
      );
      pending.abort.signal.throwIfAborted();
      this.item(pending.id, { status: "uploading", format: handle.format });
      this.update({ progress: { phase: "uploading" } });
      await runtime.show(handle, pending.abort.signal, pending.id);
      handle = null;
      pending.loaded?.(runtime, pending.id);
      this.item(pending.id, { status: "ready" });
      this.syncModels();
    } catch (error) {
      if (!pending.abort.signal.aborted && !this.disposed) {
        if (error instanceof MissingResources) {
          keepSource = true;
          this.item(pending.id, { status: "missing", missing: error.paths });
        } else {
          this.item(pending.id, { status: "error", error: toIpcError(error) });
          this.report(error);
        }
      }
    } finally {
      handle?.dispose();
      if (!keepSource) await this.close(pending);
      pending.running = false;
      if (pending.abort.signal.aborted)
        this.item(pending.id, { status: "cancelled" });
      if (pending.removed)
        this.update({
          items: this.state.items.filter((item) => item.id !== pending.id),
        });
      pending.complete();
      this.syncPending();
    }
  }
  async attach(key: string, file: File | string, id = this.state.awaitingId) {
    const pending = id ? this.pending.get(id) : undefined;
    const item = this.state.items.find((value) => value.id === id);
    if (
      !pending?.source ||
      pending.running ||
      pending.abort.signal.aborted ||
      item?.status !== "missing"
    )
      return;
    // 补文件期间也占有任务，避免删除/取消先关闭原生会话。
    pending.running = true;
    try {
      await pending.source.attach(key, file);
      pending.abort.signal.throwIfAborted();
      const missing = item.missing.filter((path) => path !== key);
      this.item(pending.id, { missing });
      if (!missing.length) {
        this.item(pending.id, { status: "queued" });
        this.queue.push(pending);
      }
    } catch (error) {
      if (!pending.abort.signal.aborted)
        this.item(pending.id, { error: toIpcError(error) });
    } finally {
      if (pending.abort.signal.aborted) {
        await this.close(pending);
        this.item(pending.id, { status: "cancelled" });
        if (pending.removed)
          this.update({
            items: this.state.items.filter((row) => row.id !== pending.id),
          });
      }
      pending.running = false;
      this.syncPending();
    }
    await this.drain();
  }
  cancel(id?: string) {
    for (const pending of this.pending.values()) {
      if (id && pending.id !== id) continue;
      pending.abort.abort();
      pending.factory = null;
      this.item(pending.id, { status: "cancelling", missing: [] });
      if (!pending.running)
        void this.close(pending).then(() => {
          this.item(pending.id, { status: "cancelled" });
          pending.complete();
          if (pending.removed)
            this.update({
              items: this.state.items.filter((item) => item.id !== pending.id),
            });
          this.syncPending();
        });
    }
  }
  remove(id: string) {
    const pending = this.pending.get(id);
    if (pending) {
      pending.removed = true;
      this.cancel(id);
    } else {
      this.runtime?.remove(id);
      this.update({ items: this.state.items.filter((item) => item.id !== id) });
      this.syncModels();
      this.syncPending();
    }
  }
  dispose() {
    this.cancel();
    this.disposed = true;
    this.runtime?.dispose();
    this.runtime = null;
  }
}
