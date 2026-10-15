import { useLingui } from "@lingui/react/macro";

import type { DiagnosticOperation } from "~/bindings";

export default function ExecutionLogLine({
  operation,
  label,
  compact = false,
}: {
  operation: DiagnosticOperation;
  label: string;
  compact?: boolean;
}) {
  const { t, i18n } = useLingui();
  const statuses = {
    passed: t({ message: "操作完成", comment: "执行日志中的成功终态" }),
    failed: t({ message: "操作失败", comment: "执行日志中的失败终态" }),
    unverified: t`生成成功，增量未验证`,
    interrupted: t({
      message: "操作中断",
      comment: "实际 worker 已退出但没有正常完成的执行日志",
    }),
    running:
      operation.phase === "preparing"
        ? t`准备请求`
        : operation.phase === "sending"
          ? t`正在发送请求`
          : operation.phase === "executing"
            ? t({
                message: "正在执行",
                comment: "SSH/SFTP 操作正在实际 worker 中执行",
              })
            : t`正在接收响应`,
  };
  const status = statuses[operation.status];
  const time = i18n.date(operation.startedAt, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return (
    <span
      className={compact ? "flex min-w-0 gap-1" : "block min-w-0 break-words"}
    >
      {compact ? (
        <span className="max-w-1/2 min-w-0 shrink-0 truncate">{status} · </span>
      ) : null}
      <span className={compact ? "min-w-0 truncate" : undefined}>
        <time className="text-muted-foreground tabular-nums">{time}</time> ·{" "}
        {label}
        {compact ? null : <> · {status}</>}
      </span>
    </span>
  );
}
