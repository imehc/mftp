import type { AppError, ModelExportAction } from "~/bindings";

import { exportError } from "./errors";
import { exportFileName } from "./file-name";
import { exportBlob } from "./native-export";

type ExportState = {
  status: "idle" | "busy" | "saved" | "shared" | "cancelled" | "failed";
  error: AppError | null;
};

export class ScreenshotExport {
  private state: ExportState = { status: "idle", error: null };
  private listeners = new Set<() => void>();
  private task: AbortController | null = null;
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(state: ExportState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  cancel = () => {
    this.task?.abort();
  };

  async save(
    capture: () => Promise<Blob>,
    name: string,
    action: ModelExportAction = "save",
  ) {
    if (this.task) return;
    const task = new AbortController();
    this.task = task;
    this.publish({ status: "busy", error: null });
    let stage: "capture" | "export" = "capture";
    try {
      const blob = await capture();
      if (task.signal.aborted) return;
      stage = "export";
      const result = await exportBlob(
        blob,
        exportFileName(name, "png"),
        action,
        task.signal,
      );
      if (!task.signal.aborted)
        this.publish({
          status:
            result === "cancelled"
              ? "cancelled"
              : result === "presented"
                ? "shared"
                : "saved",
          error: null,
        });
    } catch (error) {
      if (!task.signal.aborted) {
        this.publish({
          status: "failed",
          error: exportError(error, stage),
        });
      }
    } finally {
      this.task = null;
      if (task.signal.aborted)
        this.publish({ status: "cancelled", error: null });
    }
  }
}
