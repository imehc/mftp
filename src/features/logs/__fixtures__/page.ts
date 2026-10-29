import type { ActivityLog, DiagnosticOperation, LogPage } from "~/bindings";

export function logPage(
  operations: DiagnosticOperation[] = [],
  summaries: ActivityLog[] = [],
  discarded = 0,
): LogPage {
  return {
    entries: [
      ...operations.map((operation) => ({
        id: operation.id,
        timestamp: operation.startedAt,
        operation,
        summary:
          summaries.find((summary) => summary.operationId === operation.id) ??
          null,
      })),
      ...summaries
        .filter(
          (summary) =>
            !operations.some(
              (operation) => operation.id === summary.operationId,
            ),
        )
        .map((summary) => ({
          id: summary.id,
          timestamp: summary.createdAt,
          operation: null,
          summary,
        })),
    ],
    next: null,
    health: { discarded, error: null, malformed: 0, pending: 0 },
  };
}
