import {
  DataTexture,
  EquirectangularReflectionMapping,
  LinearFilter,
  LinearSRGBColorSpace,
  PMREMGenerator,
  type Scene,
  type WebGLRenderer,
  type WebGLRenderTarget,
  HalfFloatType,
  RGBAFormat,
} from "three";
import { modelError } from "../domain/errors";
import { toIpcError, type IpcError } from "~/lib/errors";

export class ViewerEnvironment {
  private state: {
    busy: boolean;
    name: string | null;
    error: IpcError | null;
  } = { busy: false, name: null, error: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;
  private finish: ((error?: unknown) => void) | null = null;
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
  async load(file: File) {
    if (this.disposed) return;
    this.cancel();
    const generation = ++this.generation;
    this.publish({ busy: true, error: null });
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
      if (generation === this.generation) this.publish({ name: file.name });
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
    this.finish?.(new DOMException("Cancelled", "AbortError"));
    this.publish({ busy: false });
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
    this.cancel();
    this.release();
    this.publish({ name: null, error: null });
    this.invalidate();
  }
  dispose() {
    this.disposed = true;
    this.clear();
    this.listeners.clear();
  }
}
