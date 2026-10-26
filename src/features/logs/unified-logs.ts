import type { ActivityLog, DiagnosticOperation } from "~/bindings";
import { translate } from "~/i18n/translate";

import { logAction, logObject } from "./log-labels";
import { logDetail } from "./log-utils";

export interface UnifiedLog {
  id: string;
  history: ActivityLog | null;
  operation: DiagnosticOperation | null;
}

export interface LogFiltersState {
  query: string;
  source: string;
  filter: string;
  range: string;
}

export function mergeLogs(
  history: ActivityLog[],
  operations: DiagnosticOperation[],
): UnifiedLog[] {
  const entries = new Map<string, UnifiedLog>();
  for (const operation of operations) {
    entries.set(`operation:${operation.id}`, {
      id: `operation:${operation.id}`,
      operation,
      history: null,
    });
  }
  for (const summary of history) {
    // 仅明确的操作身份可关联；旧记录不能凭来源、时间或对象猜测匹配。
    const id = summary.operationId
      ? `operation:${summary.operationId}`
      : `history:${summary.id}`;
    const existing = entries.get(id);
    entries.set(id, {
      id,
      operation: existing?.operation ?? null,
      history: summary,
    });
  }
  return [...entries.values()].sort(
    (a, b) => logTime(b) - logTime(a) || a.id.localeCompare(b.id),
  );
}

export function logTime(entry: UnifiedLog): number {
  return entry.operation?.startedAt ?? entry.history!.createdAt;
}

export function logSourceCode(entry: UnifiedLog): string {
  return entry.history?.source ?? entry.operation!.source;
}

export function unifiedLogAction(entry: UnifiedLog, localize = translate) {
  return logAction(
    entry.history ?? {
      source: entry.operation!.source,
      requestType: entry.operation!.action,
    },
    localize,
  );
}

export function unifiedLogObject(entry: UnifiedLog, localize = translate) {
  return entry.operation
    ? entry.operation.target
    : logObject(entry.history!, localize);
}

export function logResultCode(entry: UnifiedLog): string {
  // 运行期状态以真实 worker 为准，摘要到达不提前结束仍在运行的显示。
  const status = entry.operation?.status;
  if (status) {
    if (status === "passed") return "success";
    if (status === "interrupted") return "canceled";
    return status;
  }
  return entry.history!.result;
}

export function filterUnifiedLogs(
  entries: UnifiedLog[],
  filters: LogFiltersState,
  labels: Record<string, string>,
  localize = translate,
  now = Date.now(),
) {
  const query = filters.query.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    const source = logSourceCode(entry);
    const result = logResultCode(entry);
    if (filters.source !== "all" && source !== filters.source) return false;
    if (filters.filter !== "all" && result !== filters.filter) return false;
    if (filters.range === "7d" && now - logTime(entry) > 7 * 86400000)
      return false;
    if (!query) return true;
    return [
      source,
      labels[source],
      result,
      labels[result],
      unifiedLogAction(entry, localize),
      unifiedLogObject(entry, localize),
      entry.history?.id,
      entry.history?.operationId,
      entry.history?.ip,
      entry.history?.requestType,
      entry.history ? logDetail(entry.history, localize) : "",
      entry.operation?.id,
      entry.operation?.action,
      entry.operation?.target,
      entry.operation?.error?.message,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  });
}
