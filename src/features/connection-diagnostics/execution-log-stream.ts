import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type {
  DiagnosticHeader,
  DiagnosticOperation,
  DiagnosticText,
} from "~/bindings";
import { describeError } from "~/lib/errors";

import {
  hasDiagnosticDetail,
  hasDiagnosticText,
} from "./execution-log-content";

type StreamLabels = { localize: (message: MessageDescriptor) => string };

export type ExecutionLogBlock = {
  kind:
    | "request"
    | "response"
    | "command"
    | "trace"
    | "transportError"
    | "appError"
    | "capture";
  title: string;
  text: string;
};

function bodyText(body: DiagnosticText, { localize }: StreamLabels): string {
  const notes: string[] = [];
  if (body.redacted) notes.push(localize(msg`凭据已脱敏`));
  if (body.truncated) notes.push(localize(msg`内容已截断`));
  if (body.encoding === "hex" && hasDiagnosticText(body))
    notes.push(localize(msg`原始字节（十六进制）`));
  if (body.end === "interrupted") notes.push(localize(msg`读取未完成`));
  if (body.end === "protocolEnd") notes.push(localize(msg`捕获至协议结束事件`));
  if (!body.text && body.receivedBytes > 0 && !body.truncated)
    notes.push(
      localize(
        msg({
          comment: "协议流实际读取了数据，但快照未保留正文，不伪造空响应",
          message: "正文未保留",
        }),
      ),
    );
  return [body.text, notes.length ? `[${notes.join(" · ")}]` : ""]
    .filter(Boolean)
    .join("\n");
}

function headersText(
  headers: DiagnosticHeader[],
  truncated: boolean,
  { localize }: StreamLabels,
): string {
  const lines = headers
    .filter((header) => header.name || header.value)
    .map((header) => {
      const notes = [
        header.encoding === "hex" ? localize(msg`十六进制`) : "",
        header.redacted ? localize(msg`凭据已脱敏`) : "",
      ].filter(Boolean);
      return `${header.name}: ${header.value}${notes.length ? ` [${notes.join(" · ")}]` : ""}`;
    });
  if (truncated)
    lines.push(
      `[${localize(msg({ comment: "协议流中的请求头或响应头超过采集容量，紧邻对应头部", message: "头部已截断" }))}]`,
    );
  return lines.join("\n");
}

export function executionLogStream(
  operation: DiagnosticOperation,
  labels: StreamLabels,
): ExecutionLogBlock[] {
  const { localize } = labels;
  const blocks: ExecutionLogBlock[] = [];
  if (operation.trace && hasDiagnosticText(operation.trace))
    blocks.push({
      kind: "trace",
      title:
        operation.source === "games"
          ? `> TCP · ${localize(msg({ comment: "游戏局域网房间实际 TCP 连接、收发帧与 IO 错误", message: "房间协议记录" }))}`
          : `> SDK · ${localize(msg({ comment: "SSH/SFTP 实际 SDK 调用记录，不是网络抓包", message: "协议调用（库边界）" }))}`,
      text: bodyText(operation.trace, labels),
    });
  for (const detail of operation.details.filter(hasDiagnosticDetail)) {
    switch (detail.kind) {
      case "httpRequest":
        blocks.push({
          kind: "request",
          title: `> REQUEST · ${localize(msg`实际请求`)}`,
          text: [
            [
              [detail.method, detail.url].filter(Boolean).join(" "),
              headersText(detail.headers, detail.headersTruncated, labels),
            ]
              .filter(Boolean)
              .join("\n"),
            bodyText(detail.body, labels),
          ]
            .filter(Boolean)
            .join("\n\n"),
        });
        break;
      case "httpResponse":
        blocks.push({
          kind: "response",
          title: `< RESPONSE${detail.status > 0 ? ` ${detail.status}` : ""} · ${localize(msg`原始响应`)}`,
          text: [
            headersText(detail.headers, detail.headersTruncated, labels),
            bodyText(detail.body, labels),
          ]
            .filter(Boolean)
            .join("\n\n"),
        });
        break;
      case "transportError":
        blocks.push({
          kind: "transportError",
          title: `! ERROR · ${localize(msg`传输原始错误`)}`,
          text: bodyText(detail.body, labels),
        });
        break;
      case "command": {
        const lines = [bodyText(detail.command, labels)];
        if (!detail.stdoutCaptured) {
          lines.push(
            `[${localize(msg({ comment: "SSH 命令标准输出属于文件载荷，未采集文件内容", message: "文件载荷未采集" }))}]`,
          );
          lines.push(
            bodyText({ ...detail.stdout, text: "", receivedBytes: 0 }, labels),
          );
        } else if (hasDiagnosticText(detail.stdout))
          lines.push(`< STDOUT\n${bodyText(detail.stdout, labels)}`);
        if (hasDiagnosticText(detail.stderr))
          lines.push(`! STDERR\n${bodyText(detail.stderr, labels)}`);
        if (detail.exitStatus !== null) {
          const exitStatus = detail.exitStatus;
          lines.push(
            localize(
              msg({
                comment: "远端 SSH 命令原样返回的数字退出码",
                message: `退出码：${exitStatus}`,
              }),
            ),
          );
        }
        if (detail.exitSignal) {
          const exitSignal = detail.exitSignal;
          lines.push(
            localize(
              msg({
                comment: "远端 SSH 命令退出信号名称，名称不翻译",
                message: `退出信号：${exitSignal}`,
              }),
            ),
          );
        }
        blocks.push({
          kind: "command",
          title: `> COMMAND · ${localize(msg`实际执行命令`)}`,
          text: lines.filter(Boolean).join("\n\n"),
        });
        break;
      }
    }
  }
  if (operation.error)
    blocks.push({
      kind: "appError",
      title: `! APP ERROR · ${localize(msg({ comment: "应用结构化 AppError 诊断，不是原始传输错误或协议响应", message: "应用错误" }))}`,
      text: [
        describeError(operation.error, localize),
        `${operation.error.kind} · ${operation.error.code}`,
        operation.error.message,
      ]
        .filter((line, index, lines) => lines.indexOf(line) === index)
        .join("\n"),
    });
  if (
    blocks.length &&
    (operation.metadataTruncated || operation.discardedDetails > 0)
  )
    blocks.push({
      kind: "capture",
      title: "! CAPTURE",
      text: localize(
        msg({
          comment: "协议详情或元数据超出内存容量，复制文本也保留此不完整标记",
          message: "部分内容已截断",
        }),
      ),
    });
  return blocks;
}

export function executionLogStreamText(blocks: ExecutionLogBlock[]): string {
  return blocks
    .map((block) => [block.title, block.text].filter(Boolean).join("\n"))
    .join("\n\n");
}
