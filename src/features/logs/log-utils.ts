import { describeError } from "~/lib/errors";
import type { ActivityLog } from "~/types";

import { logAction, logObject } from "./log-labels";

// 历史错误的 message 与 detail 通常相同；缺失 detail 时仍须显示原始诊断。
export function logDetail(log: ActivityLog): string {
  const detail = log.detail || "";
  const error = log.error ? describeError(log.error) : "";
  return [detail, error && error !== detail ? error : ""]
    .filter(Boolean)
    .join(" · ");
}

export function filterLogs(
  logs: ActivityLog[],
  query: string,
  range: string,
  labels: Record<string, string>,
  now = Date.now(),
): ActivityLog[] {
  const q = query.trim().toLocaleLowerCase();
  return logs.filter((log) => {
    if (range === "7d" && now - log.createdAt > 7 * 24 * 60 * 60 * 1000)
      return false;
    return (
      !q ||
      [
        log.source,
        labels[log.source],
        log.ip,
        log.requestType,
        logAction(log),
        logObject(log),
        log.result,
        labels[log.result],
        logDetail(log),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(q)
    );
  });
}
