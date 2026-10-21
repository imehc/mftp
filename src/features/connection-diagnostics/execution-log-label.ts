import type { DiagnosticOperation } from "~/bindings";
import { logAction } from "~/features/logs/log-labels";

/** 操作名称 + 对象；日志列表和活动中心共用同一展示口径。 */
export function executionLogLabel(operation: DiagnosticOperation) {
  return `${logAction({ source: operation.source, requestType: operation.action })} · ${operation.target}`;
}
