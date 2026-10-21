import type { DiagnosticStatus } from "~/bindings";

export type ActivityBadgeTone = "error" | "running" | "attention" | "logs";

export interface ActivitySummary {
  failed: number;
  running: number;
  updatePending: boolean;
  logsActive: boolean;
  tone: ActivityBadgeTone | null;
  count: number | null;
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
  latestLogStatus: DiagnosticStatus | null;
}

// 执行日志只用于弱提示，避免高频外部调用把活动徽标变成噪声。
const ACTIVE_LOG_STATUSES = new Set<DiagnosticStatus>([
  "running",
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
  latestLogStatus,
}: ActivitySummaryInput): ActivitySummary {
  const failed =
    transferFailed +
    (poetrySync.phase === "error" && !poetrySync.cancelled ? 1 : 0) +
    (updater.error ? 1 : 0);
  const running =
    transferRunning + (poetrySync.active ? 1 : 0) + (updater.running ? 1 : 0);
  const logsActive =
    latestLogStatus !== null && ACTIVE_LOG_STATUSES.has(latestLogStatus);
  const tone: ActivityBadgeTone | null =
    failed > 0
      ? "error"
      : running > 0
        ? "running"
        : updater.pending
          ? "attention"
          : logsActive
            ? "logs"
            : null;
  return {
    failed,
    running,
    updatePending: updater.pending,
    logsActive,
    tone,
    count: tone === "error" ? failed : tone === "running" ? running : null,
  };
}
