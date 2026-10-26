import { vi } from "vitest";

import type { ActivityLog, DiagnosticOperation } from "~/bindings";

import type { ActivityLogsController } from "../use-activity-logs";

export const summary: ActivityLog = {
  id: "summary-1",
  operationId: "operation-1",
  createdAt: 2000,
  source: "ai",
  requestType: "ai_provider_test",
  ip: "provider-1",
  result: "success",
  detail: null,
  error: null,
};
export const operation: DiagnosticOperation = {
  id: "operation-1",
  source: "ai",
  action: "ai_provider_test",
  target: "demo-model",
  correlationId: null,
  trace: null,
  progress: null,
  discardedDetails: 0,
  metadataTruncated: false,
  redacted: false,
  startedAt: 1000,
  elapsedMs: 1000,
  status: "passed",
  phase: "finished",
  details: [],
  error: null,
};

export function createHistoryController(
  overrides: Partial<ActivityLogsController> = {},
): ActivityLogsController {
  return {
    logs: [],
    filtered: [],
    query: "",
    setQuery: vi.fn(),
    source: "all",
    setSource: vi.fn(),
    result: "all",
    setResult: vi.fn(),
    range: "all",
    setRange: vi.fn(),
    loading: false,
    error: null,
    busy: false,
    reload: vi.fn(),
    sourceLabels: { ai: "AI 服务", ssh: "SSH", todo: "待办" },
    resultLabels: { success: "成功", failed: "失败", canceled: "已取消" },
    selected: null,
    setSelected: vi.fn(),
    deleting: null,
    setDeleting: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}
