export type TaskInterruptionSource =
  | "appHidden"
  | "viewDetached"
  | "runtimeDisposed"
  | "positionChanged"
  | "sessionDisposed"
  | "superseded"
  | "paused"
  | "transition";

/** 中止原因保留结构化来源，调用方不按异常文案推断取消入口。 */
export class TaskInterruption extends DOMException {
  constructor(readonly source: TaskInterruptionSource) {
    super("Task interrupted", "AbortError");
  }
}
