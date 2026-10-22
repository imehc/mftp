import { useLingui } from "@lingui/react/macro";
import { cn } from "cn";
import {
  Check,
  CircleAlert,
  CircleDashed,
  LoaderCircle,
  OctagonX,
} from "lucide-react";

import type { DiagnosticOperation } from "~/bindings";

export default function ExecutionLogStatus({
  operation,
  showResponseCode = true,
}: {
  operation: DiagnosticOperation;
  showResponseCode?: boolean;
}) {
  const { t } = useLingui();
  const icons = {
    passed: Check,
    failed: CircleAlert,
    interrupted: OctagonX,
    unverified: CircleDashed,
    running: LoaderCircle,
  };
  const Icon = icons[operation.status];
  const response = [...operation.details]
    .reverse()
    .find((detail) => detail.kind === "httpResponse");
  const status =
    operation.status === "passed"
      ? showResponseCode &&
        response?.kind === "httpResponse" &&
        response.status > 0
        ? String(response.status)
        : t`成功`
      : operation.status === "failed"
        ? t`失败`
        : operation.status === "interrupted"
          ? t({
              comment: "日志操作未正常完成且 worker 已退出的终态",
              message: "中断",
            })
          : operation.status === "unverified"
            ? t({
                comment: "日志操作已完成但内容增量未验证",
                message: "未验证",
              })
            : operation.phase === "preparing"
              ? t({ comment: "日志操作准备阶段的短状态", message: "准备中" })
              : operation.phase === "sending"
                ? t({ comment: "日志请求正在发送的短状态", message: "发送中" })
                : operation.phase === "receiving"
                  ? t({
                      comment: "日志响应正在接收的短状态",
                      message: "接收中",
                    })
                  : t({
                      comment: "日志操作正在 worker 中执行的短状态",
                      message: "执行中",
                    });
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs font-normal whitespace-nowrap",
        {
          "text-destructive":
            operation.status === "failed" || operation.status === "interrupted",
          "text-warning": operation.status === "unverified",
          "text-muted-foreground": operation.status === "passed",
        },
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-3.5 shrink-0",
          operation.status === "running" &&
            "animate-spin motion-reduce:animate-none",
        )}
      />
      {status}
    </span>
  );
}
