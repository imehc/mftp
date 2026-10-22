import { describe, expect, it } from "vitest";

import type {
  DiagnosticDetail,
  DiagnosticOperation,
  DiagnosticText,
} from "~/bindings";

import {
  hasDiagnosticDetail,
  hasDiagnosticText,
  hasExecutionLogContent,
} from "./execution-log-content";

const empty: DiagnosticText = {
  text: "",
  receivedBytes: 0,
  capturedBytes: 0,
  encoding: "utf8",
  redacted: false,
  truncated: false,
  end: "complete",
};
const operation: DiagnosticOperation = {
  id: "summary-only",
  source: "ssh",
  action: "connect",
  target: "example.test",
  correlationId: null,
  trace: null,
  progress: null,
  discardedDetails: 0,
  metadataTruncated: false,
  redacted: false,
  startedAt: 1,
  elapsedMs: 0,
  status: "passed",
  phase: "finished",
  details: [],
  error: null,
};

describe("实际日志内容判定", () => {
  it("仅摘要、ID、时间和空容器不提供详情入口", () => {
    expect(
      hasExecutionLogContent({
        ...operation,
        trace: empty,
        details: [{ kind: "transportError", body: empty }],
      }),
    ).toBe(false);
    expect(
      hasDiagnosticDetail({
        kind: "command",
        command: empty,
        stdout: empty,
        stderr: empty,
        exitStatus: null,
        exitSignal: null,
        stdoutCaptured: false,
      }),
    ).toBe(false);
  });

  it.each([
    {
      kind: "httpRequest",
      method: "GET",
      url: "https://example.test",
      headers: [],
      headersTruncated: false,
      body: empty,
    },
    {
      kind: "httpResponse",
      status: 204,
      headers: [],
      headersTruncated: false,
      body: empty,
    },
    { kind: "transportError", body: { ...empty, text: "Socket closed" } },
    {
      kind: "command",
      command: { ...empty, text: "pwd" },
      stdout: empty,
      stderr: empty,
      exitStatus: 0,
      exitSignal: null,
      stdoutCaptured: true,
    },
  ] satisfies DiagnosticDetail[])(
    "实际采集的 $kind 即使正文为空也可以阅读",
    (detail) => {
      expect(hasExecutionLogContent({ ...operation, details: [detail] })).toBe(
        true,
      );
    },
  );

  it("原始调用与结构化错误都可读，但不伪造原始协议内容", () => {
    expect(
      hasExecutionLogContent({
        ...operation,
        trace: { ...empty, text: "Session::handshake" },
      }),
    ).toBe(true);
    expect(
      hasExecutionLogContent({
        ...operation,
        error: {
          kind: "external",
          code: "ssh:test",
          message: "Handshake failed",
          args: {},
        },
      }),
    ).toBe(true);
  });

  it("明确截断或中断的实际正文不被视为空内容", () => {
    expect(hasDiagnosticText({ ...empty, truncated: true })).toBe(true);
    expect(hasDiagnosticText({ ...empty, end: "interrupted" })).toBe(true);
    expect(hasDiagnosticText(empty)).toBe(false);
  });
});
