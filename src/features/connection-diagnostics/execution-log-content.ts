import type {
  DiagnosticDetail,
  DiagnosticOperation,
  DiagnosticText,
} from "~/bindings";

export function hasDiagnosticText(body: DiagnosticText | null): boolean {
  return (
    body !== null &&
    (body.text.length > 0 ||
      body.truncated ||
      body.receivedBytes > 0 ||
      body.end === "interrupted" ||
      body.end === "protocolEnd")
  );
}

export function hasDiagnosticDetail(detail: DiagnosticDetail): boolean {
  switch (detail.kind) {
    case "httpRequest":
      return Boolean(
        detail.method ||
        detail.url ||
        detail.headers.some((header) => header.name || header.value) ||
        detail.headersTruncated ||
        hasDiagnosticText(detail.body),
      );
    case "httpResponse":
      return (
        detail.status > 0 ||
        detail.headers.some((header) => header.name || header.value) ||
        detail.headersTruncated ||
        hasDiagnosticText(detail.body)
      );
    case "command":
      return (
        hasDiagnosticText(detail.command) ||
        hasDiagnosticText(detail.stdout) ||
        hasDiagnosticText(detail.stderr) ||
        detail.exitStatus !== null ||
        Boolean(detail.exitSignal)
      );
    case "transportError":
      return hasDiagnosticText(detail.body);
  }
}

export function hasExecutionLogContent(
  operation: DiagnosticOperation,
): boolean {
  return (
    operation.error !== null ||
    hasDiagnosticText(operation.trace) ||
    operation.details.some(hasDiagnosticDetail)
  );
}

export function executionLogIsFailed(operation: DiagnosticOperation): boolean {
  return operation.status === "failed" || operation.status === "interrupted";
}
