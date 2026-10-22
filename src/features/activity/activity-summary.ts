import type { DiagnosticStatus } from "~/bindings";

export type ActivityBadgeTone = "error" | "running" | "attention";

export type ActivityKind =
  "transfer" | "sync" | "update" | "logs" | "mixed" | "idle";

export interface ActivitySummary {
  failed: number;
  running: number;
  updatePending: boolean;
  logsActive: boolean;
  tone: ActivityBadgeTone | null;
  count: number | null;
  kind: ActivityKind;
  destination: "tasks" | "logs" | null;
}

export interface ActivitySummaryInput {
  transferRunning: number;
  transferFailed: number;
  poetrySync: {
    active: boolean;
    phase: string | null;
    /** 用户主动取消的同步以 error 阶段结束，但不能算作失败任务。 */
    cancelled?: boolean;
  };
  updater: {
    running: boolean;
    pending: boolean;
    error: boolean;
  };
  logStatuses: readonly DiagnosticStatus[];
}

// 执行日志只用于弱提示，避免高频外部调用把活动徽标变成噪声。
const FAILED_LOG_STATUSES = new Set<DiagnosticStatus>([
  "failed",
  "interrupted",
]);

/**
 * 汇总活动入口的徽标状态：失败优先，其次运行中，再其次更新与日志提示。
 * 数量和优先级在此纯函数内决定，展示层只负责按 tone 选择样式。
 */
export function summarizeActivity({
  transferRunning,
  transferFailed,
  poetrySync,
  updater,
  logStatuses,
}: ActivitySummaryInput): ActivitySummary {
  const failed =
    transferFailed +
    (poetrySync.phase === "error" && !poetrySync.cancelled ? 1 : 0) +
    (updater.error ? 1 : 0);
  const running =
    transferRunning + (poetrySync.active ? 1 : 0) + (updater.running ? 1 : 0);
  const logFailed = logStatuses.some((status) =>
    FAILED_LOG_STATUSES.has(status),
  );
  const logRunning = logStatuses.includes("running");
  const logsActive = logFailed || logRunning;
  const kinds: ActivityKind[] = [];
  if (transferRunning > 0 || transferFailed > 0) kinds.push("transfer");
  if (
    poetrySync.active ||
    (poetrySync.phase === "error" && !poetrySync.cancelled)
  )
    kinds.push("sync");
  if (updater.running || updater.pending || updater.error) kinds.push("update");
  if (logsActive) kinds.push("logs");
  const tone: ActivityBadgeTone | null =
    failed > 0 || logFailed
      ? "error"
      : running > 0 || logRunning
        ? "running"
        : updater.pending
          ? "attention"
          : null;
  return {
    failed,
    running,
    updatePending: updater.pending,
    logsActive,
    tone,
    count:
      tone === "error" && failed > 0
        ? failed
        : tone === "running" && running > 0
          ? running
          : null,
    kind: kinds.length > 1 ? "mixed" : (kinds[0] ?? "idle"),
    destination:
      failed > 0
        ? "tasks"
        : logFailed
          ? "logs"
          : running > 0
            ? "tasks"
            : logRunning
              ? "logs"
              : updater.pending
                ? "tasks"
                : null,
  };
}
