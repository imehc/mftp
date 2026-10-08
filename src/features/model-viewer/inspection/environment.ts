import {
  DataTexture,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  PMREMGenerator,
  RGBAFormat,
  type Scene,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";

import { type IpcError, toIpcError } from "~/lib/errors";
import { isTauriRuntime } from "~/lib/files";

import { modelError } from "../domain/errors";
import {
  readEnvironment,
  saveEnvironment,
} from "../library/environment-storage";

export class ViewerEnvironment {
  private state: {
    busy: boolean;
    name: string | null;
    error: IpcError | null;
    storageError: IpcError | null;
    saving: boolean;
  } = {
    busy: false,
    name: null,
    error: null,
    storageError: null,
    saving: false,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;
  private finish: ((error?: unknown) => void) | null = null;
  private storageTask: AbortController | null = null;
  private source: File | null = null;
  private restoreFailed = false;
  private target: WebGLRenderTarget | null = null;
  private texture: DataTexture | null = null;
  constructor(
    private scene: Scene,
    private renderer: WebGLRenderer,
    private invalidate: () => void,
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  async load(file: File, persist = true) {
    if (this.disposed) return;
    this.cancel();
    const generation = ++this.generation;
    this.restoreFailed = false;
    this.publish({ busy: true, error: null, storageError: null });
    try {
      await new Promise<void>((resolve, reject) => {
        const worker = new Worker(new URL("./hdr.worker.ts", import.meta.url), {
          type: "module",
        });
        this.finish = (error) => {
          worker.terminate();
          this.finish = null;
          if (error) reject(error);
          else resolve();
        };
        worker.onerror = () => {
          if (generation === this.generation)
            this.finish?.(modelError("decode"));
        };
        worker.onmessage = (event) => {
          if (generation !== this.generation) return;
          if (event.data.error) {
            this.finish?.(modelError("invalid"));
            return;
          }
          let texture: DataTexture | null = null;
          let generator: PMREMGenerator | null = null;
          try {
            generator = new PMREMGenerator(this.renderer);
            const { data, width, height } = event.data.result;
            texture = new DataTexture(
              data,
              width,
              height,
              RGBAFormat,
              HalfFloatType,
            );
            texture.colorSpace = LinearSRGBColorSpace;
            texture.mapping = EquirectangularReflectionMapping;
            texture.minFilter = LinearFilter;
            texture.magFilter = LinearFilter;
            texture.flipY = true;
            texture.needsUpdate = true;
            const target = generator.fromEquirectangular(texture);
            this.release();
            this.target = target;
            this.texture = texture;
            this.scene.environment = target.texture;
            this.scene.background = texture;
            this.invalidate();
            this.finish?.();
          } catch {
            texture?.dispose();
            this.finish?.(modelError("decode"));
          } finally {
            generator?.dispose();
          }
        };
        worker.postMessage(file);
      });
      if (generation === this.generation) {
        this.source = file;
        this.publish({ name: file.name, storageError: null });
        if (persist) await this.persist(generation);
      }
    } catch (error) {
      if (generation === this.generation) {
        this.finish?.(error);
        this.publish({ error: toIpcError(error) });
      }
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  cancel() {
    this.generation++;
    this.storageTask?.abort();
    this.storageTask = null;
    this.finish?.(new DOMException("Cancelled", "AbortError"));
    this.publish({ busy: false, saving: false });
  }
  private release() {
    this.scene.environment = null;
    this.scene.background = null;
    this.target?.dispose();
    this.texture?.dispose();
    this.target = null;
    this.texture = null;
  }
  clear() {
    if (this.disposed) return;
    this.cancel();
    this.release();
    this.source = null;
    this.restoreFailed = false;
    this.publish({ name: null, error: null, storageError: null });
    this.invalidate();
    void this.persist(this.generation);
  }
  async restore() {
    if (this.disposed || !isTauriRuntime()) return;
    this.cancel();
    const generation = this.generation;
    const task = new AbortController();
    this.storageTask = task;
    this.restoreFailed = false;
    this.publish({ busy: true, storageError: null });
    try {
      const file = await readEnvironment(task.signal);
      if (generation === this.generation && file) await this.load(file, false);
    } catch (error) {
      if (generation === this.generation) {
        this.restoreFailed = true;
        this.publish({ storageError: toIpcError(error) });
      }
    } finally {
      if (generation === this.generation) {
        this.storageTask = null;
        this.publish({ busy: false });
      }
    }
  }
  private async persist(generation: number) {
    if (!isTauriRuntime() || this.disposed) return;
    const task = new AbortController();
    this.storageTask = task;
    this.publish({ saving: true });
    try {
      await saveEnvironment(this.source, task.signal);
      if (generation === this.generation) this.publish({ storageError: null });
    } catch (error) {
      if (generation === this.generation)
        this.publish({ storageError: toIpcError(error) });
    } finally {
      if (generation === this.generation) {
        this.storageTask = null;
        this.publish({ saving: false });
      }
    }
  }
  retrySave() {
    if (!this.disposed && !this.state.busy && !this.state.saving)
      return this.restoreFailed
        ? this.restore()
        : this.persist(this.generation);
    return Promise.resolve();
  }
  dispose() {
    this.disposed = true;
    this.cancel();
    this.release();
    this.source = null;
    this.publish({ name: null, error: null, storageError: null });
    this.listeners.clear();
  }
}
