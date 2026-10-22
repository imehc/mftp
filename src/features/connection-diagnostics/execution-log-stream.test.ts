import { i18n, type MessageDescriptor } from "@lingui/core";
import { beforeEach, describe, expect, it } from "vitest";

import type { DiagnosticOperation, DiagnosticText } from "~/bindings";

import {
  executionLogStream,
  executionLogStreamText,
} from "./execution-log-stream";

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
  id: "internal-id",
  source: "http",
  action: "GET",
  target: "https://example.test",
  correlationId: "transfer-id",
  trace: null,
  progress: null,
  discardedDetails: 0,
  metadataTruncated: false,
  redacted: false,
  startedAt: 1000,
  elapsedMs: 20,
  status: "passed",
  phase: "finished",
  details: [],
  error: null,
};
const localize = (message: MessageDescriptor) => i18n._(message);
const stream = (overrides: Partial<DiagnosticOperation>) =>
  executionLogStream({ ...operation, ...overrides }, { localize });

beforeEach(() => {
  i18n.load("zh-CN", {});
  i18n.activate("zh-CN");
});

describe("终端协议流投影", () => {
  it("请求头和正文保持实际顺序与换行，空响应不造正文或时间戳", () => {
    const blocks = stream({
      details: [
        {
          kind: "httpRequest",
          method: "POST",
          url: "https://example.test/long?value=" + "a".repeat(1000),
          headers: [
            {
              name: "Accept",
              value: "application/json",
              encoding: "utf8",
              redacted: false,
            },
          ],
          headersTruncated: false,
          body: { ...empty, text: '{\n  "name": "实际值"\n}\n' },
        },
        {
          kind: "httpResponse",
          status: 204,
          headers: [],
          headersTruncated: false,
          body: empty,
        },
      ],
    });
    const text = executionLogStreamText(blocks);
    expect(blocks.map((block) => block.kind)).toEqual(["request", "response"]);
    expect(text).toContain(
      'Accept: application/json\n\n{\n  "name": "实际值"\n}\n',
    );
    expect(blocks[1].title).toContain("< RESPONSE 204");
    expect(blocks[1].text).toBe("");
    expect(text).not.toMatch(
      /空正文|等待接收|internal-id|transfer-id|1970|已捕获/,
    );
  });

  it("库边界、命令、原始错误和应用错误分别标识，不推断网络响应", () => {
    const blocks = stream({
      trace: { ...empty, text: "Session::handshake\n" },
      details: [
        {
          kind: "command",
          command: { ...empty, text: "pwd" },
          stdout: { ...empty, text: "/home/user\n" },
          stderr: { ...empty, text: "warning\n" },
          exitStatus: 1,
          exitSignal: "TERM",
          stdoutCaptured: true,
        },
        {
          kind: "transportError",
          body: { ...empty, text: "connection reset by peer" },
        },
      ],
      error: {
        kind: "external",
        code: "ssh:transport",
        message: "Operation failed",
        args: {},
      },
    });
    expect(blocks.map((block) => block.kind)).toEqual([
      "trace",
      "command",
      "transportError",
      "appError",
    ]);
    expect(blocks[0].title).toContain("库边界");
    expect(blocks[1].text).toContain("< STDOUT\n/home/user\n");
    expect(blocks[1].text).toContain("! STDERR\nwarning\n");
    expect(blocks[1].text).toContain("退出码：1");
    expect(blocks[1].text).toContain("退出信号：TERM");
    expect(blocks[2].text).toBe("connection reset by peer");
    expect(blocks[3].title).toContain("APP ERROR");
    expect(blocks[3].text).toContain("ssh:transport");
    expect(executionLogStreamText(blocks)).not.toContain("RESPONSE");
  });

  it("未采集文件载荷只保留采集状态，字节统计不进入默认流", () => {
    const blocks = stream({
      details: [
        {
          kind: "command",
          command: { ...empty, text: "tar cf - data" },
          stdout: {
            ...empty,
            text: "not-observable-file-payload",
            receivedBytes: 9000,
            end: "interrupted",
          },
          stderr: empty,
          exitStatus: null,
          exitSignal: null,
          stdoutCaptured: false,
        },
      ],
    });
    const text = executionLogStreamText(blocks);
    expect(text).toContain("文件载荷未采集");
    expect(text).toContain("读取未完成");
    expect(text).not.toMatch(/9000|not-observable-file-payload|STDOUT|STDERR/);
  });

  it("脱敏、十六进制、截断和读取结束状态紧邻实际内容", () => {
    const blocks = stream({
      details: [
        {
          kind: "httpResponse",
          status: 200,
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
              encoding: "hex",
              redacted: true,
            },
          ],
          headersTruncated: true,
          body: {
            ...empty,
            text: "ab cd",
            redacted: true,
            truncated: true,
            encoding: "hex",
            end: "protocolEnd",
          },
        },
      ],
      discardedDetails: 1,
    });
    const text = executionLogStreamText(blocks);
    expect(text).toContain("Authorization: [REDACTED] [十六进制 · 凭据已脱敏]");
    expect(text).toContain("头部已截断");
    expect(text).toContain(
      "ab cd\n[凭据已脱敏 · 内容已截断 · 原始字节（十六进制） · 捕获至协议结束事件]",
    );
    expect(blocks.at(-1)?.kind).toBe("capture");
  });

  it("空容器及空头部不提供流，真实结束状态和无保留正文仍可识别", () => {
    expect(
      stream({
        details: [
          {
            kind: "httpRequest",
            method: "",
            url: "",
            headers: [
              { name: "", value: "", encoding: "utf8", redacted: false },
            ],
            headersTruncated: false,
            body: empty,
          },
        ],
      }),
    ).toEqual([]);
    expect(
      stream({ trace: { ...empty, end: "protocolEnd" } })[0].text,
    ).toContain("捕获至协议结束事件");
    expect(stream({ trace: { ...empty, receivedBytes: 5 } })[0].text).toContain(
      "正文未保留",
    );
  });
});
