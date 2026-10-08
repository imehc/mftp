import type { IpcError } from "~/lib/errors";
import { toIpcError } from "~/lib/errors";

import { modelError } from "../domain/errors";
import type { ModelEntry } from "../runtime/collection";
import { sampleGeometry } from "./geometry";
import type {
  AnalysisRequest,
  TopologyReport,
  ValidationReport,
} from "./types";

type DiagnosticState = {
  busy: "validation" | "topology" | "dimensions" | null;
  validation: ValidationReport | null;
  topology: TopologyReport[] | null;
  dimensions: number[] | null;
  error: IpcError | null;
};

export class ModelDiagnostics {
  private state: DiagnosticState = {
    busy: null,
    validation: null,
    topology: null,
    dimensions: null,
    error: null,
  };
  private listeners = new Set<() => void>();
  private abort: AbortController | null = null;
  private worker: Worker | null = null;
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<DiagnosticState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  cancel = () => {
    this.abort?.abort();
    this.abort = null;
    this.worker?.terminate();
    this.worker = null;
    this.publish({ busy: null });
  };
  clear() {
    this.cancel();
    this.publish({
      validation: null,
      topology: null,
      dimensions: null,
      error: null,
    });
  }
  invalidatePose() {
    if (this.state.busy && this.state.busy !== "validation") this.cancel();
    if (this.state.topology || this.state.dimensions)
      this.publish({ topology: null, dimensions: null });
  }
  async run(
    entry: ModelEntry,
    kind: "validation" | "topology" | "dimensions",
    tolerance: number,
  ) {
    this.cancel();
    const abort = new AbortController();
    this.abort = abort;
    this.publish({ busy: kind, error: null });
    try {
      let request: AnalysisRequest;
      if (kind === "validation") {
        if (!entry.handle.validationSource) throw modelError("unsupported");
        request = { kind, source: entry.handle.validationSource };
      } else {
        entry.animation.pause();
        const { samples, bounds } = await sampleGeometry(entry, abort.signal);
        abort.signal.throwIfAborted();
        this.publish({
          dimensions: bounds.isEmpty()
            ? [0, 0, 0]
            : [
                bounds.max.x - bounds.min.x,
                bounds.max.y - bounds.min.y,
                bounds.max.z - bounds.min.z,
              ],
        });
        if (kind === "dimensions") {
          this.cancel();
          return;
        }
        request = { kind, meshes: samples, tolerance };
      }
      abort.signal.throwIfAborted();
      const worker = new Worker(
        new URL("./analysis.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker = worker;
      worker.onmessage = (event) => {
        if (abort.signal.aborted) return;
        if (event.data.error) this.publish({ error: modelError("invalid") });
        else if (kind === "validation")
          this.publish({ validation: event.data.result });
        else this.publish({ topology: event.data.result });
        this.cancel();
      };
      worker.onerror = () => {
        if (!abort.signal.aborted) {
          this.publish({ error: modelError("decode") });
          this.cancel();
        }
      };
      const transfer =
        request.kind === "topology"
          ? request.meshes.flatMap((m) => [
              m.positions.buffer,
              m.indices.buffer,
              ...(m.normals ? [m.normals.buffer] : []),
            ])
          : [];
      worker.postMessage(request, transfer);
    } catch (error) {
      if (!abort.signal.aborted) {
        this.publish({ error: toIpcError(error) });
        this.cancel();
      }
    }
  }
  dispose() {
    this.cancel();
    this.listeners.clear();
  }
}
