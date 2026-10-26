import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it } from "vitest";

import { operation, summary } from "./__fixtures__/history";
import { filterUnifiedLogs, logResultCode, mergeLogs } from "./unified-logs";

beforeEach(() => {
  i18n.load("zh-CN", {});
  i18n.activate("zh-CN");
});

describe("历史摘要与运行期详情关联", () => {
  it("只按明确操作身份合并，即使两边对象和时间不同", () => {
    const entries = mergeLogs([summary], [operation]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      id: "operation:operation-1",
      history: summary,
      operation,
    });
  });

  it("无关联旧数据和相同对象的其他操作独立展示", () => {
    const legacy = { ...summary, operationId: null };
    expect(mergeLogs([legacy], [operation])).toHaveLength(2);
    expect(
      mergeLogs([{ ...summary, operationId: "other" }], [operation]),
    ).toHaveLength(2);
  });

  it("运行记录、合并记录、详情淘汰后的摘要保持相同行身份", () => {
    const first = mergeLogs([], [operation])[0];
    const linked = mergeLogs([summary], [operation])[0];
    const retained = mergeLogs([summary], [])[0];
    expect(first.id).toBe(linked.id);
    expect(linked.id).toBe(retained.id);
    expect(retained.history).toBe(summary);
    expect(retained.operation).toBeNull();
  });

  it("清除任一数据源不会删除另一数据源，也不修改输入", () => {
    expect(mergeLogs([], [operation])[0].operation).toBe(operation);
    expect(mergeLogs([summary], [])[0].history).toBe(summary);
    expect(summary.operationId).toBe(operation.id);
  });

  it("同名历史标识与操作标识不会冲突，记录按时间倒序", () => {
    const legacy = {
      ...summary,
      id: operation.id,
      operationId: null,
      createdAt: 3000,
    };
    const entries = mergeLogs([legacy, summary], [operation]);
    expect(entries.map((entry) => entry.id)).toEqual([
      "history:operation-1",
      "operation:operation-1",
    ]);
  });

  it("历史先写入时仍以真实 worker 状态显示运行中", () => {
    const entry = mergeLogs(
      [summary],
      [{ ...operation, status: "running" }],
    )[0];
    expect(logResultCode(entry)).toBe("running");
  });

  it("搜索覆盖翻译、原始代码、完整对象及关联身份", () => {
    const entries = mergeLogs([summary], [operation]);
    for (const query of [
      "测试 AI 服务",
      "ai_provider_test",
      "provider-1",
      "demo-model",
      "operation-1",
      "summary-1",
    ]) {
      expect(
        filterUnifiedLogs(
          entries,
          { query, source: "all", filter: "all", range: "all" },
          {},
        ),
      ).toEqual(entries);
    }
  });

  it("来源、结果、时间筛选同时作用于两类记录", () => {
    const entries = mergeLogs(
      [
        summary,
        {
          ...summary,
          id: "legacy",
          operationId: null,
          result: "failed",
          createdAt: 10,
        },
      ],
      [{ ...operation, status: "running" }],
    );
    expect(
      filterUnifiedLogs(
        entries,
        { query: "", source: "ai", filter: "running", range: "all" },
        {},
      ),
    ).toHaveLength(1);
    expect(
      filterUnifiedLogs(
        entries,
        { query: "", source: "ssh", filter: "all", range: "all" },
        {},
      ),
    ).toHaveLength(0);
    expect(
      filterUnifiedLogs(
        entries,
        { query: "", source: "all", filter: "all", range: "7d" },
        {},
        undefined,
        8 * 86400000,
      ),
    ).toHaveLength(0);
  });
});
