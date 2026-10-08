import type { ModelLibraryCatalog, ModelLibraryEdit } from "~/bindings";
import { toIpcError, type IpcError } from "~/lib/errors";
import {
  modelLibraryCache,
  modelLibraryCatalog,
  modelLibraryDelete,
  modelLibraryDocument,
  modelLibraryEdit,
  modelLibrarySaveView,
  modelLibraryThumbnail,
} from "~/lib/ipc";
import type { ViewerSession } from "../runtime/session";
import { librarySource, saveModel } from "./storage";

// 跨页面按调用顺序提交元数据；退出页的最后快照不会晚于新页快照落库。
let writes: Promise<unknown> = Promise.resolve();

function write<T>(run: () => Promise<T>): Promise<T> {
  const result = writes.then(run, run);
  writes = result.catch(() => {});
  return result;
}

type LibraryState = {
  catalog: ModelLibraryCatalog | null;
  busy: number;
  error: IpcError | null;
  failed: boolean;
};

export class ModelLibraryController {
  private state: LibraryState = {
    catalog: null,
    busy: 0,
    error: null,
    failed: false,
  };
  private listeners = new Set<() => void>();
  private alive = false;
  private generation = 0;
  private refreshGeneration = 0;
  private seen = new Set<string>();
  private ids = new Map<string, string>();
  private failed = new Set<string>();
  private last = "";
  private viewFailure = false;
  private viewWriting = false;
  private uploads: Promise<unknown> = Promise.resolve();
  private uploading = new Map<string, AbortController>();
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private session: ViewerSession) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(value: Partial<LibraryState>) {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => listener());
  }
  private busy(delta: number) {
    this.publish({ busy: Math.max(0, this.state.busy + delta) });
    if (this.state.busy === 0) this.flush();
  }
  report = (error: unknown) => {
    if (this.alive) this.publish({ error: toIpcError(error) });
  };
  clearError() {
    this.publish({ error: null });
  }
  async refresh() {
    const generation = ++this.refreshGeneration;
    const catalog = await modelLibraryCatalog();
    if (this.alive && generation === this.refreshGeneration)
      this.publish({ catalog });
    return catalog;
  }
  start() {
    this.alive = true;
    this.seen.clear();
    this.ids.clear();
    this.failed.clear();
    this.last = "";
    this.viewFailure = false;
    const generation = ++this.generation;
    const revision = this.session.revision;
    this.unsubscribe = this.session.subscribe(this.scan);
    this.timer = setInterval(() => this.flush(), 2000);
    document.addEventListener("visibilitychange", this.visibility);
    window.addEventListener("pagehide", this.flush);
    this.busy(1);
    void this.refresh()
      .then((catalog) => {
        if (
          this.alive &&
          generation === this.generation &&
          revision === this.session.revision &&
          !this.session.snapshot().items.length &&
          catalog.lastId
        )
          void this.open(catalog.lastId);
      })
      .catch(this.report)
      .finally(() => this.busy(-1));
  }
  private visibility = () => {
    if (document.hidden) this.flush();
  };
  private scan = () => {
    if (!this.alive) return;
    const runtime = this.session.runtime;
    if (!runtime) return;
    for (const item of this.session.snapshot().items) {
      if (item.status !== "ready" || this.seen.has(item.id)) continue;
      this.seen.add(item.id);
      if (item.libraryId) {
        this.ids.set(item.id, item.libraryId);
        continue;
      }
      const entry = runtime.models.entries.get(item.id);
      if (!entry?.handle.archive) continue;
      const view = runtime.captureState(item.id);
      if (!entry || !view) continue;
      const abort = new AbortController();
      this.uploading.set(item.id, abort);
      this.busy(1);
      // 在模型仍持有当前帧时生成缩略图；压缩异步完成后不再访问已释放运行时。
      let thumbnail: Promise<Blob | null> | null = null;
      try {
        if (runtime.models.selected === item.id)
          thumbnail = runtime.thumbnail();
      } catch (error) {
        this.report(error);
      }
      const generation = this.generation;
      const save = this.uploads.then(() =>
        saveModel(entry.handle, view, abort.signal, this.report),
      );
      this.uploads = save.catch(() => {});
      void save
        .then(async (id) => {
          if (!this.alive || abort.signal.aborted) return;
          this.ids.set(item.id, id);
          const blob = await thumbnail;
          if (blob && !abort.signal.aborted)
            await modelLibraryThumbnail(
              id,
              Array.from(new Uint8Array(await blob.arrayBuffer())),
            );
          if (this.alive && generation === this.generation) this.flush();
          await this.refresh();
        })
        .catch((error) => {
          if (!abort.signal.aborted) {
            if (!this.ids.has(item.id)) {
              this.failed.add(item.id);
              this.publish({ failed: true });
            }
            this.report(error);
          }
        })
        .finally(() => {
          this.uploading.delete(item.id);
          this.busy(-1);
        });
    }
  };
  flush = () => this.persist(false);
  private persist(final: boolean) {
    if (
      !this.alive ||
      this.viewFailure ||
      ((this.viewWriting || this.state.busy > 0) && !final)
    )
      return;
    const selected = this.session.snapshot().selected;
    const id = selected ? this.ids.get(selected) : undefined;
    const view = this.session.runtime?.captureState();
    if (!id || !view) return;
    const key = JSON.stringify([id, view]);
    if (key === this.last) return;
    this.last = key;
    this.viewWriting = true;
    const generation = this.generation;
    void write(() => modelLibrarySaveView(id, view))
      .catch((error) => {
        if (generation !== this.generation || !this.alive) return;
        this.viewFailure = true;
        this.publish({ failed: true });
        this.report(error);
      })
      .finally(() => {
        this.viewWriting = false;
      });
  }
  retry() {
    // 只有用户显式重试才重新执行失败的写操作。
    this.viewFailure = false;
    this.last = "";
    for (const id of this.failed) this.seen.delete(id);
    this.failed.clear();
    this.publish({ failed: false, error: null });
    this.scan();
    this.flush();
  }
  async open(id: string) {
    this.flush();
    const generation = ++this.generation;
    const revision = this.session.revision;
    const existing = [...this.ids].find(([, value]) => value === id);
    if (existing && this.session.runtime?.models.entries.has(existing[0])) {
      this.session.runtime.select(existing[0]);
      this.session.runtime.fit(existing[0]);
      return;
    }
    this.busy(1);
    try {
      const document = await modelLibraryDocument(id);
      if (
        !this.alive ||
        generation !== this.generation ||
        revision !== this.session.revision
      )
        return;
      await this.session.enqueue([
        {
          name: document.sourceName,
          libraryId: id,
          open: () => librarySource(id, document),
          loaded: (runtime, modelId) => {
            if (
              this.alive &&
              generation === this.generation &&
              revision + 1 === this.session.revision
            )
              runtime.restoreState(modelId, document.view);
          },
        },
      ]);
      this.scan();
      this.flush();
      const runtime = this.session.runtime;
      if (
        this.alive &&
        generation === this.generation &&
        runtime?.models.current &&
        this.ids.get(runtime.models.selected!) === id &&
        !this.state.catalog?.entries.find((entry) => entry.id === id)
          ?.hasThumbnail
      ) {
        const thumbnail = await runtime.thumbnail();
        if (thumbnail && this.alive && generation === this.generation) {
          await modelLibraryThumbnail(
            id,
            Array.from(new Uint8Array(await thumbnail.arrayBuffer())),
          );
          await this.refresh();
        }
      }
    } catch (error) {
      this.report(error);
    } finally {
      this.busy(-1);
    }
  }
  async edit(id: string, input: ModelLibraryEdit) {
    this.busy(1);
    try {
      await write(() => modelLibraryEdit(id, input));
      await this.refresh();
    } finally {
      this.busy(-1);
    }
  }
  async delete(id: string) {
    this.busy(1);
    try {
      await write(() => modelLibraryDelete(id));
      for (const [modelId, libraryId] of this.ids)
        if (libraryId === id) this.ids.delete(modelId);
      await this.refresh();
    } finally {
      this.busy(-1);
    }
  }
  async cache(max: number, clear: boolean) {
    this.busy(1);
    try {
      await write(() => modelLibraryCache(max, clear));
      await this.refresh();
    } finally {
      this.busy(-1);
    }
  }
  stop() {
    this.persist(true);
    this.alive = false;
    this.generation++;
    this.unsubscribe?.();
    clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.visibility);
    window.removeEventListener("pagehide", this.flush);
    this.uploading.forEach((abort) => abort.abort());
  }
}
